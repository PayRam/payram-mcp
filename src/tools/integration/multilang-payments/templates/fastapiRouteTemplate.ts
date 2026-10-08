import { SnippetResponse } from '../../common/snippetTypes.js';

const notes =
  "FastAPI example that forwards POST /api/pay/create to Payram's /api/v1/payment endpoint.";

export const buildFastapiPaymentRouteSnippet = (): SnippetResponse => ({
  title: 'FastAPI route for Payram create-payment API',
  snippet: `import os

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

PAYRAM_PAYMENT_PATH = '/api/v1/payment'

class CreatePaymentPayload(BaseModel):
    customerEmail: EmailStr
    customerID: str  # capital "ID" — backend binds json:"customerID"
    amountInUSD: float

app = FastAPI()

@app.post('/api/pay/create')
async def create_payment(payload: CreatePaymentPayload):
    base_url = os.getenv('PAYRAM_BASE_URL')
    api_key = os.getenv('PAYRAM_API_KEY')

    if not base_url or not api_key:
        raise HTTPException(status_code=500, detail='payram_not_configured')

    normalized_base = base_url.rstrip('/')

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{normalized_base}{PAYRAM_PAYMENT_PATH}",
                headers={'API-Key': api_key, 'Content-Type': 'application/json'},
                json=payload.dict(),
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'payram_upstream_error: {exc}') from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.json())

    return response.json()
`,
  meta: {
    language: 'python',
    framework: 'fastapi',
    filenameSuggestion: 'app/api/payram_payment.py',
    description:
      'FastAPI handler that creates Payram payments via the external /api/v1/payment endpoint.',
  },
  notes,
});
