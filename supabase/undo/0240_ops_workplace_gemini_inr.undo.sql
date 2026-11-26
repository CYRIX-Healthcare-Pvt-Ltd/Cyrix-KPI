-- Undo 0240.
update ops_target set name = 'Inventory', url = 'https://cyrix-inventory.vercel.app/inventory/' where id = 'inventory';
delete from ops_ai_price where model_prefix = 'gemini-3.6-flash';
delete from app_settings where key = 'usd_inr';
delete from _migrations where filename = '0240_ops_workplace_gemini_inr.sql';
