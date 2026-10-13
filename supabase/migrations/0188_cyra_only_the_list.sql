-- =====================================================================
-- Cyrix KPI  ·  0188  ·  CYRA for the people on the list only
--
-- The user, 13 Oct (Book1.xlsx): "only need to enable cyra app for these
-- users only, and currently admin people also keep it". CYRA goes to the
-- listed E-codes, to everyone ticked Review or Admin in Software Admin →
-- CYRA, and to the test accounts; nobody else keeps it.
-- =====================================================================

create temp table cyra_keep on commit drop as
select e.id from employees e
where upper(e.ecode) in ('E694', 'E1085', 'E2257', 'E2311', 'E2329', 'E1120', 'E1119', 'E784', 'E1132', 'E1019', 'E649', 'E2174', 'E2264', 'E2363', 'E918', 'E1512', 'E2241', 'E1476', 'E2039', 'E2260', 'E905', 'E621', 'E1403', 'E923', 'E1842', 'E2283', 'E2312', 'E692', 'E1342', 'E1504', 'E619', 'E620', 'E722', 'E625', 'E725', 'E2200', 'E336', 'E659', 'E675', 'E863', 'E896', 'E1290', 'E1455', 'E658', 'E662', 'E742', 'E830', 'E1391', 'E1968', 'E2181', 'CT658', 'E1654', 'E1252', 'E1732', 'E777', 'E962', 'E956', 'E630', 'E2261', 'E1251', 'E958', 'E959', 'E1087', 'E916', 'E1955', 'E2256', 'E1389', 'E740', 'E805', 'E2175', 'E2262', 'E622', 'E738', 'E682', 'E1403', 'E904', 'E668', 'E803', 'E671', 'E657', 'E663', 'E673', 'E661', 'E688', 'E678', 'E669', 'E176', 'E641', 'E667', 'FTC13', 'E1218', 'E1092', 'E835', 'E750', 'E1313', 'E1411', 'E2150', 'E1805', 'E2218', 'E2177', 'E8888', 'E9999')
   or e.id in (select employee_id from cyra_access where review or admin);

delete from employee_modules where module_code = 'cyra' and employee_id not in (select id from cyra_keep);
insert into employee_modules (employee_id, module_code)
select id, 'cyra' from cyra_keep join employees e using (id) where e.is_active
on conflict do nothing;
