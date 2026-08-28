'use client';

import { GroupMemberRole, GroupSummary } from '../lib/groups-api';

const ROLE_LABELS: Record<GroupMemberRole, string> = { viewer: 'צופה', editor: 'עורך', manager: 'מנהל' };

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
    <div className="border border-outline-variant rounded-DEFAULT divide-y divide-outline-variant max-h-60 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="font-body-sm text-body-sm text-on-surface truncate">{g.name}</span>
          <select
            aria-label={`תפקיד בקבוצה ${g.name}`}
            value={roleFor(g.id)}
            onChange={(e) => setRole(g.id, e.target.value as GroupMemberRole | '')}
            className="bg-surface border border-outline-variant rounded-DEFAULT py-1 px-2 font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shrink-0"
          >
            <option value="">לא חבר</option>
            {(Object.entries(ROLE_LABELS) as [GroupMemberRole, string][]).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
