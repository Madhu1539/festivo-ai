"""Gemini client (§13.6).

The API key never leaves the backend (§19.1). All provider failure modes listed
in §13.5 are mapped onto the application's error envelope.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from ..config import get_settings
from ..errors import (
    AIInvalidOutput,
    AINotConfigured,
    AIRateLimited,
    AITimeout,
    AIUnavailable,
)

log = logging.getLogger("festivo.gemini")


class GeminiClient:
    """Thin wrapper over the Gemini generateContent REST endpoint."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.gemini_api_key:
            raise AINotConfigured()
        self._key = settings.gemini_api_key
        self._model = settings.gemini_model
        self._base = settings.gemini_base_url.rstrip("/")
        self._timeout = settings.ai_timeout_seconds
        self._settings = settings

    @property
    def model(self) -> str:
        return self._model

    async def generate_json(
        self,
        *,
        system_instruction: str,
        contents: list[dict[str, Any]],
        response_schema: dict[str, Any],
    ) -> dict[str, Any]:
        """Call the model and return parsed JSON. Raises AppError subclasses."""
        url = f"{self._base}/models/{self._model}:generateContent"
        payload: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "contents": contents,
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": response_schema,
                "temperature": self._settings.ai_temperature,
                "maxOutputTokens": self._settings.ai_max_output_tokens,
            },
        }
        # Thinking tokens are billed against maxOutputTokens and can truncate
        # structured output, so a non-negative setting is sent explicitly.
        # A negative setting omits thinkingConfig entirely, which leaves the
        # model on its own default rather than disabling thinking.
        if self._settings.gemini_thinking_budget >= 0:
            payload["generationConfig"]["thinkingConfig"] = {
                "thinkingBudget": self._settings.gemini_thinking_budget
            }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    url,
                    headers={
                        "x-goog-api-key": self._key,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            log.warning("Gemini timeout: %s", exc)
            raise AITimeout() from exc
        except httpx.HTTPError as exc:
            log.warning("Gemini transport error: %s", exc)
            raise AIUnavailable() from exc

        self._raise_for_status(response)
        return self._extract_json(response.json())

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.is_success:
            return

        # Log the provider detail server-side only (§15.7).
        log.warning(
            "Gemini HTTP %s: %s", response.status_code, response.text[:800]
        )
        status = response.status_code
        if status == 429:
            raise AIRateLimited()
        if status in (401, 403):
            raise AINotConfigured(
                "The configured Gemini API key was rejected. "
                "Check GEMINI_API_KEY in the backend environment."
            )
        if status == 404:
            raise AIUnavailable(
                f"The model '{self._model}' is not available for this API key."
            )
        if status == 400:
            raise AIUnavailable(
                "The plan request was rejected by the AI provider. Please try again."
            )
        # Everything else, 5xx included, is an unavailable provider.
        raise AIUnavailable()

    def _extract_json(self, body: dict[str, Any]) -> dict[str, Any]:
        prompt_feedback = body.get("promptFeedback") or {}
        if prompt_feedback.get("blockReason"):
            log.warning("Gemini blocked prompt: %s", prompt_feedback)
            raise AIInvalidOutput(
                "The event details could not be processed by the AI provider. "
                "Please rephrase your preferences and try again."
            )

        candidates = body.get("candidates") or []
        if not candidates:
            log.warning("Gemini returned no candidates: %s", str(body)[:500])
            raise AIInvalidOutput()

        candidate = candidates[0]
        finish = candidate.get("finishReason")
        if finish == "MAX_TOKENS":
            raise AIInvalidOutput(
                "The generated plan was cut short. Please try generating it again."
            )
        if finish in ("SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "RECITATION"):
            log.warning("Gemini stopped early: %s", finish)
            raise AIInvalidOutput(
                "The AI provider could not complete this plan. "
                "Please adjust the event details and try again."
            )

        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts).strip()
        if not text:
            log.warning("Gemini returned empty text, finishReason=%s", finish)
            raise AIInvalidOutput()

        return _parse_json_object(text)


def _parse_json_object(text: str) -> dict[str, Any]:
    """Parse JSON, tolerating code fences or surrounding prose."""
    candidates = [text]

    if "```" in text:
        fenced = text.split("```")
        for chunk in fenced:
            cleaned = chunk.strip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()
            if cleaned.startswith("{"):
                candidates.append(cleaned)

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed

    log.warning("Gemini output was not valid JSON: %s", text[:500])
    raise AIInvalidOutput()
