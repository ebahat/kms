# Requirements for Implementing Logic: C1.1 User Management & C1.2 Add User

This document outlines the functional requirements, validation logic, and state management for the User Management and Add User screens within the Enterprise Knowledge Base.

---

## 1. Screen C1.1 — User Group Management (ניהול קבוצות למשתמש)

### A. Search & Filter Bar
- **Search Logic**: Real-time filtering on the table based on 'Name' or 'Email'. 
- **Filters**:
    - **Status Filter**: Dropdown with options: 'All', 'Active', 'Suspended'.
    - **Role Filter**: Dropdown with options: 'All', 'Admin', 'Editor', 'Viewer'.
- **Debounce**: Implement a 300ms debounce on the search input to reduce API calls.

### B. User Table
- **Empty State**: Show "No users found" if search/filter returns zero results.
- **Actions**:
    - **Edit (Pencil Icon)**: Opens the user detail/edit view.
    - **Deactivate/Reactivate (Circle/Slash Icon)**: Triggers a confirmation modal before changing the user's status.
- **Pagination**: 10 users per page. Show "Showing 1-4 of 45 users" (מציג 1-4 מתוך 45 משתמשים).

### C. Group Assignment (Assign to Groups)
- **Input Field**: Searchable multi-select.
- **Search Behavior**: Fetch matching groups from the `/api/groups` endpoint as the user types.
- **Selection**:
    - Adding a group creates a chip (badge) with an 'X' icon.
    - Clicking 'X' removes the group from the temporary selection list.
- **Bulk Action**: The "Assign to Groups" button applies the selected groups to all users currently checked in the table.

### D. Bulk Import (CSV/Excel)
- **Trigger**: "Import Users" (ייבוא משתמשים מרוכז) button.
- **Logic**:
    - Validate file type (CSV/XLSX).
    - Client-side validation for email formats and required fields.
    - **Error Reporting**: If rows fail (as shown in the red banner), generate a downloadable Excel/CSV error report detailing the specific row and failure reason.

---

## 2. Screen C1.2 — Add User (צור משתמש חדש)

### A. Form Fields & Validation
- **Full Name (שם מלא)**: Required.
- **Email Address (כתובת אימייל)**: Required. Must pass regex validation for standard email formats.
- **Constraint**: Email must be unique within the tenant. Check against DB on blur or submission.

### B. Role Selection (תפקיד)
- **Component**: Radio cards.
- **Behavior**: Single selection required. 
    - **Viewer (צופה)**: Read-only access.
    - **Editor (עורך)**: Can add/edit documents.
    - **Admin (מנהל מערכת)**: Full settings and user management access.

### C. Group Assignment (שיוך לקבוצות)
- **Logic**: Same as C1.1. Search and select multiple groups.
- **State**: Selection must be stored in an array before form submission.

### D. Submission Flow
- **Cancel (ביטול)**: Returns to C1.1 without saving.
- **Create User (צור משתמש)**:
    - **Loading State**: Disable button and show a loading skeleton or progress indicator.
    - **Success State**:
        1. API returns success.
        2. Show toast: "User created successfully. An email was sent for password setup." (המשתמש נוצר בהצלחה. נשלח אימייל להגדרת סיסמה).
        3. Redirect back to User Management (C1.1).
    - **Error State**: Show specific field errors (e.g., "Email already exists") or a global error banner if the API fails.

---

## 3. Global Considerations (RTL & Localisation)
- **Text Alignment**: All labels and inputs must be right-aligned.
- **Numbers/Dates**: Render LTR within the RTL layout (e.g., time in Audit Log or version numbers).
- **Mixed Content**: Ensure the layout handles usernames containing both Hebrew and English characters without breaking line-height or alignment.


# Updated Implementation Requirements: Group Selection Logic (C1.1 & C1.2)

This document specifies the behavior and logic for the persistent group selection grid, replacing the previous searchable chip pattern. These requirements apply to both the **User Management (C1.1)** bulk assignment area and the **Add User (C1.2)** creation form.

---

## 1. Component: Toggle Grid (שיוך לקבוצות)

### A. Layout & Density
- **Grid Structure**: 3-column grid by default on desktop. 
- **Responsiveness**: Should wrap to 2 columns or 1 column if the container width is constrained.
- **Spacing**: Use `spacing.gutter` (16px) between items.
- **Item Design**: Each group is represented by a large-format toggle card containing:
    - Group Name (Primary label).
    - Status Indicator (Checkbox or Checkmark icon).
    - Optional: Member count (e.g., "15 חברים").

### B. Selection Logic
- **Multi-Select**: Users can select any number of groups.
- **Toggling**: Clicking anywhere on a card toggles its selection state.
- **Visual States**:
    - **Unselected**: `surface-container-lowest` background with an `outline-variant` border.
    - **Selected**: `primary-container` background with `on-primary-container` text/icon and a 2px `primary` border.
    - **Hover**: Subtle `surface-container-high` highlight for unselected items.

### C. Overflow & Scrolling
- **Max Height**: Set a maximum height for the grid container (e.g., 240px or approx. 4 rows).
- **Scrolling Behavior**: 
    - If groups exceed the max height, the container must become vertically scrollable (`overflow-y: auto`).
    - Use a custom, thin scrollbar that matches the "Cognitive Architecture" aesthetic (tonal, rounded).
    - **Fading Edge**: Use a subtle CSS mask or gradient at the bottom of the container to indicate more content below.

---

## 2. Contextual Behaviors

### A. Add User Form (C1.2)
- **Initial State**: All groups unselected by default.
- **Form Submission**: The `groups` array in the POST payload should contain the IDs of all toggled groups.
- **Validation**: While group selection is optional, the UI should handle "Required" constraints if specific system policies demand at least one group.

### B. Bulk Assignment (C1.1)
- **Selection Context**: The grid applies to the users currently selected in the main table.
- **Partial Selection State**: If multiple users are selected who already have different groups:
    - Groups common to *all* selected users show as **Selected**.
    - Groups belonging to *none* of the users show as **Unselected**.
    - Groups belonging to *some* users show an **Indeterminate** state (e.g., a minus icon instead of a checkmark). Clicking an indeterminate card should force it to "Selected" for all.
- **Action**: The "Apply" button updates only the delta (additions/removals) to the backend.

---

## 3. Accessibility & Keyboard
- **Tab Order**: Users must be able to `Tab` through the grid items.
- **Activation**: `Space` or `Enter` keys must toggle the selection state when an item is focused.
- **Aria Roles**: Use `role="checkbox"` and `aria-checked="true/false"` for each card.
- **Focus Ring**: High-visibility focus ring using the `primary` color must appear on keyboard focus.

---

## 4. Performance
- **Virtualization**: For tenants with >50 groups (edge case), implement list virtualization to maintain 60fps scrolling.
- **Optimistic UI**: Reflect toggle changes immediately in the UI before the API confirms (if applicable in bulk flows).