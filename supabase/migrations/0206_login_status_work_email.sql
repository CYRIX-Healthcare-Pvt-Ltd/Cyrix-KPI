-- The official email on the Logins tab, for IT Admin (the user, 15 Oct).
create or replace view public.v_login_status as
 SELECT e.id AS employee_id,
    e.ecode,
    e.full_name,
    e.designation,
    e.department,
    e.is_active,
    m.ecode AS manager_ecode,
    m.full_name AS manager_name,
    u.email AS login_email,
    (u.id IS NOT NULL) AS has_login,
    e.password_is_default AS on_issued_default,
    u.created_at AS login_created_at,
    u.last_sign_in_at,
    u.updated_at AS password_changed_at,
        CASE
            WHEN (u.id IS NULL) THEN 'No login issued'::text
            WHEN (e.password_is_default AND (u.last_sign_in_at IS NULL)) THEN 'Never signed in'::text
            WHEN e.password_is_default THEN 'Using the issued default'::text
            ELSE 'Set their own password'::text
        END AS login_state,
    e.function_name,
    COALESCE(( SELECT a.status
           FROM (kpi_assignments a
             JOIN financial_years f ON ((f.code = a.financial_year)))
          WHERE ((a.employee_id = e.id) AND (CURRENT_DATE >= f.starts_on) AND (CURRENT_DATE <= f.ends_on))
          ORDER BY a.updated_at DESC NULLS LAST
         LIMIT 1), 'not_set_up'::text) AS kpi_status,
    (( SELECT count(*) AS count
           FROM (kpi_submissions s
             JOIN financial_years f2 ON ((f2.code = s.financial_year)))
          WHERE ((s.employee_id = e.id) AND (CURRENT_DATE >= f2.starts_on) AND (CURRENT_DATE <= f2.ends_on) AND (s.status = ANY (ARRAY['scored'::text, 'finalized'::text])))))::integer AS months_scored,
    e.work_email
   FROM ((employees e
     LEFT JOIN auth.users u ON ((u.id = e.auth_user_id)))
     LEFT JOIN employees m ON ((m.id = e.reporting_manager_id)));
