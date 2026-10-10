-- =====================================================================
-- Cyrix KPI  ·  0168  ·  Any colour for a Digest post
--
-- The user, 10 Oct: "need more colours picker also". Besides the eight
-- named colours, a post may carry any colour as #rrggbb.
-- =====================================================================

alter table digest_posts drop constraint if exists digest_posts_color_check;
alter table digest_posts add constraint digest_posts_color_check
  check (color in ('red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink') or color ~ '^#[0-9a-fA-F]{6}$');
