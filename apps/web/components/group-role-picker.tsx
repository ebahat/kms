'use client';

import { GroupMemberRole, GroupSummary } from '../lib/groups-api';

export const ROLE_LABELS: Record<GroupMemberRole, string> = { viewer: 'צופה', editor: 'עורך', manager: 'מנהל' };

/**
 * Distinct color per tier (2026-08-29, from the c1.2_updated_group_controls Stitch mockup's own
 * tailwind.config — 'admin' there is this app's 'manager'). Full static class strings, not
 * `bg-role-${role}` interpolation — Tailwind's build-time scanner only picks up literal class
 * names, so a template string here would silently produce no CSS in production. Exported for
 * `groups/[id]/page.tsx`'s member-role select, which needs the identical treatment.
 */
export const ROLE_SELECT_COLOR: Record<GroupMemberRole, string> = {
  viewer: 'bg-role-viewer border-role-viewer text-on-primary focus:ring-role-viewer',
  editor: 'bg-role-editor border-role-editor text-on-primary focus:ring-role-editor',
  manager: 'bg-role-admin border-role-admin text-on-primary focus:ring-role-admin',
};
export const ROLE_ROW_TINT: Record<GroupMemberRole, string> = {
  viewer: 'bg-role-viewer/10 hover:bg-role-viewer/20',
  editor: 'bg-role-editor/10 hover:bg-role-editor/20',
  manager: 'bg-role-admin/10 hover:bg-role-admin/20',
};
export const UNASSIGNED_SELECT_COLOR = 'bg-surface border-outline-variant text-on-surface focus:ring-primary';

export type GroupAssignment = { groupId: string; role: GroupMemberRole };

/**
 * Shared by the create-user form and the edit-user screen (user-management plan, 2026-08-24) — a
 * list of the tenant's groups, each with an inline role selector defaulting to "not a member".
 * Chosen over the ADR mockup's toggle-grid-with-indeterminate-state for the same information at far
 * less UI surface; revisit only if the group count makes a flat list unwieldy.
 */
export function GroupRolePicker({
  groups,
  value,
  onChange,
}: {
  groups: GroupSummary[];
  value: GroupAssignment[];
  onChange: (next: GroupAssignment[]) => void;
}) {
  function roleFor(groupId: string): GroupMemberRole | '' {
    return value.find((a) => a.groupId === groupId)?.role ?? '';
  }

  function setRole(groupId: string, role: GroupMemberRole | '') {
    const withoutThisGroup = value.filter((a) => a.groupId !== groupId);
    onChange(role === '' ? withoutThisGroup : [...withoutThisGroup, { groupId, role }]);
  }

  if (groups.length === 0) {
    return <p className="font-body-sm text-body-sm text-on-surface-variant">אין קבוצות בארגון.</p>;
  }

  return (
    <div className="flex flex-col border border-outline-variant rounded-lg overflow-hidden bg-surface max-h-60 overflow-y-auto divide-y divide-outline-variant">
      {groups.map((g) => {
        const role = roleFor(g.id);
        return (
          <div
            key={g.id}
            className={`flex items-center justify-between gap-3 px-3 py-2 transition-colors ${role === '' ? 'hover:bg-surface-container-low' : ROLE_ROW_TINT[role]}`}
          >
            <span className="font-body-sm text-body-sm text-on-surface truncate">{g.name}</span>
            <select
              aria-label={`תפקיד בקבוצה ${g.name}`}
              value={role}
              onChange={(e) => setRole(g.id, e.target.value as GroupMemberRole | '')}
              className={`rounded-DEFAULT py-1 px-2 border font-body-sm text-body-sm focus:outline-none focus:ring-1 shrink-0 ${role === '' ? UNASSIGNED_SELECT_COLOR : ROLE_SELECT_COLOR[role]}`}
            >
              <option value="">לא חבר</option>
              {(Object.entries(ROLE_LABELS) as [GroupMemberRole, string][]).map(([r, label]) => (
                <option key={r} value={r}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
