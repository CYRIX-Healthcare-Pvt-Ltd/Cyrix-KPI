-- =====================================================================
-- Cyrix KPI  ·  0162  ·  Signed out after 3 hours with nothing done
--
-- The user, 10 Oct: "auto logout ... on inactive 3 hrs". Read by
-- src/lib/idleSignOut.ts in every Cyrix app. installed_app false: the
-- installed phone app stays signed in. Changing these needs no deploy.
-- =====================================================================

insert into app_settings (key, value, description) values
  ('idle_sign_out', '{"hours": 3, "installed_app": false}'::jsonb,
   'Hours with no activity anywhere in Cyrix before a browser is signed out (a minute''s warning first). installed_app: whether the installed app is signed out too.')
on conflict (key) do nothing;
