/**
 * Stripe webhook — raw body required for signature verification.
 * Configure endpoint: https://<host>/api/stripe-webhook
 * Env: STRIPE_WEBHOOK_SECRET
 */
import {
  applySubscriptionToProfile,
  findUserIdForCustomer,
  getStripe
} from "../server-utils/stripeBilling.js";

export const config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function resolveUserIdFromSubscription(subscription) {
  const metaUser = subscription?.metadata?.user_id;
  if (metaUser) return String(metaUser);
  const customerId = typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id;
  return findUserIdForCustomer(customerId);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  const stripe = getStripe();
  const whSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripe || !whSecret) {
    return res.status(503).json({ ok: false, error: "Stripe webhook neconfigurat." });
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, whSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature", err?.message || err);
    return res.status(400).json({ ok: false, error: `Webhook Error: ${err?.message || "invalid"}` });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        const userId = session.client_reference_id || session.metadata?.user_id;
        const subId = session.subscription;
        if (!userId || !subId) break;
        const subscription = await stripe.subscriptions.retrieve(String(subId));
        await applySubscriptionToProfile({
          userId: String(userId),
          customerId: String(session.customer || ""),
          subscription
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const userId = await resolveUserIdFromSubscription(subscription);
        if (!userId) {
          console.warn("[stripe-webhook] no user for subscription", subscription.id);
          break;
        }
        await applySubscriptionToProfile({
          userId,
          customerId: String(subscription.customer || ""),
          subscription
        });
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break;
        const subscription = await stripe.subscriptions.retrieve(String(subId));
        const userId = await resolveUserIdFromSubscription(subscription);
        if (!userId) break;
        await applySubscriptionToProfile({
          userId,
          customerId: String(subscription.customer || invoice.customer || ""),
          subscription
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook] handler", event.type, err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "handler failed" });
  }

  return res.status(200).json({ ok: true, received: true });
}
