-- ============================================================================
-- 0054  APPROVE, AND CORRECT THE ROLE WHILE DOING IT
-- ----------------------------------------------------------------------------
-- `approve_staff` could only grant the role the registrant claimed. If somebody
-- picked the wrong one from the dropdown — which is the single most likely
-- mistake on that form, made by a new employee on their first day — the
-- administrator's only options were to refuse it and ask them to register
-- again, or approve a role they knew was wrong.
--
-- Neither is reasonable. Registering again means a second account for somebody
-- to clean up, and the person now has two logins for one job.
--
-- So approval takes an OPTIONAL corrected role. The administrator is still
-- confirming rather than composing — the claim is what they are shown, and the
-- override is a deliberate extra act recorded separately in the audit trail.
--
-- WHAT DOES NOT CHANGE
--   · Only an administrator may call it.
--   · Never on your own registration.
--   · 'admin' and 'client' cannot be granted here. The first administrator is
--     made by hand, and a customer is not a staff role.
--   · This is still the ONLY route by which profiles.role may change. The
--     immutability trigger from 0052 is untouched.
-- ============================================================================

create or replace function public.approve_staff(
  p_user_id uuid,
  p_approve boolean,
  p_reason text default null,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile record;
  v_granted public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may approve a staff registration.'
      using errcode = '42501';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot approve your own registration.' using errcode = '42501';
  end if;

  select id, email, full_name, requested_role, approval_status
    into v_profile
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  if v_profile.approval_status is distinct from 'pending' then
    raise exception 'That registration has already been dealt with.' using errcode = '22023';
  end if;

  if p_approve then
    /* The corrected role, if one was given, otherwise what they asked for.
       Validated against the same whitelist the registration form uses, so the
       override cannot reach further than the form could. */
    if p_role is not null then
      if p_role not in ('sales', 'project_engineer', 'inventory_manager', 'accountant', 'technician') then
        raise exception
          'A staff registration cannot be approved as %. Administrators are created in the Supabase dashboard, and a customer is not a staff role.',
          p_role
          using errcode = '22023';
      end if;
      v_granted := p_role::public.user_role;
    else
      v_granted := v_profile.requested_role;
    end if;

    if v_granted is null then
      raise exception 'That registration did not name a role, and none was supplied.'
        using errcode = '22023';
    end if;

    perform set_config('solarbros.role_change_approved', 'yes', true);

    update public.profiles
    set role = v_granted,
        is_active = true,
        approval_status = 'approved',
        approved_by = (select auth.uid()),
        approved_at = now(),
        rejection_reason = null
    where id = p_user_id;

    perform set_config('solarbros.role_change_approved', '', true);

    /* A correction is recorded as its own fact. "Approved as accountant" and
       "asked to be an accountant and was approved as one" are different
       events, and only one of them is a disagreement worth finding later. */
    perform public.write_audit(
      'staff_registration_approved', 'profiles', p_user_id::text, 'warning',
      jsonb_build_object(
        'email', v_profile.email,
        'claimed_role', v_profile.requested_role,
        'granted_role', v_granted,
        'corrected', v_granted is distinct from v_profile.requested_role
      )
    );

    insert into public.notifications (user_id, title, body, channel, category, entity, entity_id)
    values (
      p_user_id,
      'Your staff account has been approved',
      case
        when v_granted is distinct from v_profile.requested_role
          then 'You can now sign in at the staff portal. Your role was set to ' ||
               replace(v_granted::text, '_', ' ') || '.'
        else 'You can now sign in at the staff portal.'
      end,
      'in_app', 'account', 'profiles', p_user_id::text
    );
  else
    update public.profiles
    set approval_status = 'rejected',
        is_active = false,
        approved_by = (select auth.uid()),
        approved_at = now(),
        rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where id = p_user_id;

    perform public.write_audit(
      'staff_registration_rejected', 'profiles', p_user_id::text, 'warning',
      jsonb_build_object('email', v_profile.email, 'claimed_role', v_profile.requested_role)
    );
  end if;
end;
$$;

/* The three-argument version is dropped so there is exactly one signature.
   Leaving both would let a caller reach the old behaviour by omitting an
   argument, which is how two code paths quietly diverge. */
drop function if exists public.approve_staff(uuid, boolean, text);

revoke all on function public.approve_staff(uuid, boolean, text, text) from public, anon;
grant execute on function public.approve_staff(uuid, boolean, text, text) to authenticated;

comment on function public.approve_staff(uuid, boolean, text, text) is
  'The only path by which profiles.role may change. Grants the claimed role, or a corrected one an administrator supplies. Never admin, never client, never your own account.';
