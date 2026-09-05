export type PaymentCredentials = {
  accessToken: string;
  webhookSecret: string;
  publicKey: string;
  enabled: boolean;
  accountId: string;
  accountEmail: string;
  liveMode: boolean;
  applePayStatus: string;
  source: 'store' | 'legacy' | 'none';
};

export async function paymentCredentials(db: any, storeId: string): Promise<PaymentCredentials> {
  const empty: PaymentCredentials = {
    accessToken: '', webhookSecret: '', publicKey: '', enabled: false,
    accountId: '', accountEmail: '', liveMode: false,
    applePayStatus: 'provider_required', source: 'none'
  };
  if (storeId) {
    const { data, error } = await db.rpc('get_payment_provider_secret', {
      target_store_id: storeId,
      requested_provider: 'mercadopago'
    });
    if (!error && data?.[0]) {
      const row = data[0];
      return {
        accessToken: String(row.access_token || ''),
        webhookSecret: String(row.webhook_secret || ''),
        publicKey: String(row.public_key || ''),
        enabled: row.enabled === true,
        accountId: String(row.account_id || ''),
        accountEmail: String(row.account_email || ''),
        liveMode: row.live_mode === true,
        applePayStatus: String(row.apple_pay_status || 'provider_required'),
        source: 'store'
      };
    }
    if (error && !/get_payment_provider_secret|schema cache|does not exist/i.test(error.message || '')) throw error;
  }

  const accessToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
  if (!accessToken) return empty;
  return {
    ...empty,
    accessToken,
    webhookSecret: Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '',
    enabled: true,
    liveMode: accessToken.startsWith('APP_USR-'),
    source: 'legacy'
  };
}

export async function recordPaymentAttempt(db: any, values: Record<string, unknown>) {
  const row = {
    store_id: values.storeId,
    order_id: values.orderId || null,
    order_number: String(values.orderNumber || ''),
    provider: String(values.provider || 'mercadopago'),
    payment_method: String(values.paymentMethod || ''),
    status: String(values.status || 'error'),
    external_reference: String(values.externalReference || ''),
    amount: Math.max(0, Number(values.amount) || 0),
    reason_code: String(values.reasonCode || '').slice(0, 160),
    reason_message: String(values.reasonMessage || '').slice(0, 500),
    source: String(values.source || 'checkout').slice(0, 40),
    occurred_at: values.occurredAt || new Date().toISOString()
  };
  const { error } = await db.from('payment_attempts').insert(row);
  if (error && !/payment_attempts|schema cache|does not exist/i.test(error.message || '')) {
    console.error('Falha ao registrar tentativa de pagamento:', error.message);
  }
}

export async function recordAnalyticsEvent(db: any, values: Record<string, unknown>) {
  const items = Array.isArray(values.items) ? values.items.slice(0, 40).map((item: any) => ({
    item_id: String(item?.item_id || item?.productId || item?.id || '').slice(0, 120),
    item_name: String(item?.item_name || item?.name || '').slice(0, 160),
    price: Math.max(0, Number(item?.price ?? item?.unitTotal ?? item?.basePrice) || 0),
    quantity: Math.max(1, Math.min(999, Number(item?.quantity) || 1))
  })) : [];
  const row = {
    store_id: values.storeId,
    session_id: String(values.sessionId || '').slice(0, 120),
    event_name: String(values.eventName || ''),
    order_id: values.orderId || null,
    value: Math.max(0, Number(values.value) || 0),
    currency: 'BRL',
    item_count: items.reduce((sum: number, item: any) => sum + item.quantity, 0),
    items,
    attribution: values.attribution && typeof values.attribution === 'object' ? values.attribution : {},
    consent: values.consent && typeof values.consent === 'object' ? values.consent : {}
  };
  const { error } = await db.from('store_analytics_events').insert(row);
  if (error && !/store_analytics_events|schema cache|does not exist/i.test(error.message || '')) {
    console.error('Falha ao registrar evento do funil:', error.message);
  }
}

export function paymentFailure(result: any, fallback: string) {
  const cause = Array.isArray(result?.cause) ? result.cause[0] : null;
  const detail = String(
    result?.status_detail || result?.error || cause?.code || result?.errors?.[0]?.code || ''
  );
  const message = String(
    cause?.description || result?.message || result?.errors?.[0]?.message || fallback
  );
  return { code: detail.slice(0, 160), message: message.slice(0, 500) };
}
