import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildMercadoPagoAuthorizationUrl,
  decryptSecret,
  encryptSecret,
  randomIdempotencyKey,
  sha256Base64Url,
  validateMercadoPagoWebhookSignature,
} from '../lib/mercadopago-utils.js';

test('OAuth URL usa Authorization Code + PKCE S256', () => {
  const verifier = 'verifier-de-teste-1234567890123456789012345678901234567890';
  const challenge = sha256Base64Url(verifier);
  const url = new URL(buildMercadoPagoAuthorizationUrl({
    clientId: '123456',
    redirectUri: 'https://playbarmusic.onrender.com/api/mercadopago/oauth/callback',
    state: 'estado-seguro',
    codeChallenge: challenge,
  }));

  assert.equal(url.origin, 'https://auth.mercadopago.com');
  assert.equal(url.pathname, '/authorization');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), '123456');
  assert.equal(url.searchParams.get('state'), 'estado-seguro');
  assert.equal(url.searchParams.get('code_challenge'), challenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('tokens OAuth são criptografados e recuperados com a mesma chave', () => {
  const secret = 'segredo-muito-forte-para-testes';
  const token = 'APP_USR-token-ultra-secreto';
  const encrypted = encryptSecret(token, secret);

  assert.notEqual(encrypted, token);
  assert.equal(decryptSecret(encrypted, secret), token);
  assert.throws(() => decryptSecret(encrypted, 'outra-chave'));
});

test('assinatura de webhook Mercado Pago valida o manifest oficial', () => {
  const secret = 'webhook-secret';
  const dataId = 'PAY123';
  const requestId = 'REQ-ABC';
  const ts = '1760000000000';
  const manifest = 'id:pay123;request-id:REQ-ABC;ts:1760000000000;';
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  assert.equal(validateMercadoPagoWebhookSignature({
    secret,
    xSignature: `ts=${ts},v1=${hash}`,
    xRequestId: requestId,
    dataId,
  }), true);

  assert.equal(validateMercadoPagoWebhookSignature({
    secret,
    xSignature: `ts=${ts},v1=${hash}`,
    xRequestId: requestId,
    dataId: 'outro-id',
  }), false);
});

test('idempotency key é UUID', () => {
  assert.match(
    randomIdempotencyKey(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
