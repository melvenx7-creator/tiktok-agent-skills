# Shotstack setup

## API environments

- Sandbox: `https://api.shotstack.io/edit/stage`
- Production: `https://api.shotstack.io/edit/v1`

Use the matching API key for each environment. Sandbox output is watermarked; production output is unwatermarked and consumes account credits. AI-generated assets can consume credits even in sandbox. Check the Shotstack dashboard and current pricing before production use.

## Secure setup

Copy `.env.example` to `.env` in this folder and set `SHOTSTACK_API_KEY`. `.env` is ignored by Git. Never paste the key into prompts, source files, public issues or browser code.

## Render lifecycle

1. Submit an Edit JSON with `POST /render`.
2. Save `response.id`.
3. Query `GET /render/{id}` until status is `done` or `failed`.
4. Only present an output link after status is `done`.

The API's returned temporary output URL expires; use Shotstack hosting/CDN details or configure your own storage if a durable delivery link is required.

## AI voice and generated media

The agent must not hardcode model names or voice IDs. It should query the account's current model catalogue (`GET /models?expand=options`) and select only models marked available. Voice language/style preferences come from the user's prompt. Confirm the selected model's options and credit estimate before generating chargeable AI assets.
