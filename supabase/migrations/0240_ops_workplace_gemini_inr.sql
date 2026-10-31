-- =====================================================================
-- Cyrix KPI  ·  0240  ·  Workplace uptime URL, Gemini price, USD to INR
--
-- 1. 0238 added the inventory app at cyrix-inventory.vercel.app, but
--    that Vercel project has since been renamed cyrix-workplace. The
--    portal serves it at /workplace/, and /inventory now redirects
--    there. The check moves to the real URL.
-- 2. Pulse's AI chat runs on gemini-3.6-flash and had no price row, so
--    its calls showed as unpriced. Prices are $0.75 input, $0.075
--    cached and $3.75 output per 1M tokens (pricepertoken.com, 31 Oct
--    2026). Thinking tokens bill as output, and Pulse already counts
--    them there.
-- 3. app_settings.usd_inr is the rate the Ops page uses to show rupees
--    beside dollars. Changing it is a one-row update, with no deploy.
-- =====================================================================

update ops_target
set name = 'Workplace', url = 'https://cyrix-workplace.vercel.app/workplace/'
where id = 'inventory';

insert into ops_ai_price (model_prefix, input_per_m, cached_per_m, output_per_m, source) values
  ('gemini-3.6-flash', 0.75, 0.075, 3.75, 'pricepertoken.com, 31 Oct 2026')
on conflict (model_prefix) do update
  set input_per_m = excluded.input_per_m, cached_per_m = excluded.cached_per_m,
      output_per_m = excluded.output_per_m, source = excluded.source;

insert into app_settings (key, value, description) values
  ('usd_inr', '94.5'::jsonb,
   'Rupees per US dollar, used by the Ops page to show INR beside AI costs. About 94.5 at the end of Oct 2026; update when it drifts.')
on conflict (key) do nothing;
