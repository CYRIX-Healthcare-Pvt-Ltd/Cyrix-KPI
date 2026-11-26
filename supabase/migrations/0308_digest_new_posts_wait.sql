-- 0308 · Cyrix Digest: a new post starts unpublished, so its first Publish waits for SW Admin
--
-- 23 Nov 2026: HR's "INTERNAL JOB POSTING (IJP) - BIOMEDICAL INCHARGE" went out at 10:38
-- with no approval. digest_save inserted the post with published_at = now() (the column's
-- default), so digest_set_published saw it as already out, took it for an edit of a live post
-- (free since 0299) and never set approval = 'pending'. Only drafts published later were
-- caught. A new post now has no published_at until Publish, which is then its first time:
-- from anyone but SW Admin it waits; SW Admin's own go straight out as before.
alter table public.digest_posts alter column published_at drop default;
