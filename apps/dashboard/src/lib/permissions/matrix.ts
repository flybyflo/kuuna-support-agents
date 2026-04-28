export type StaffRole = "owner" | "admin" | "operator" | "viewer";

export type PermissionResource =
  | "overview"
  | "todos"
  | "templates"
  | "bindings"
  | "prompts"
  | "knowledge"
  | "messages"
  | "audit"
  | "users"
  | "assignments"
  | "hardDelete";

export type PermissionAction = "read" | "write" | "publish" | "delete";

type PermissionMap = Record<PermissionResource, PermissionAction[]>;

const OWNER_PERMISSIONS: PermissionMap = {
  overview: ["read"],
  todos: ["read", "write"],
  templates: ["read", "write", "publish"],
  bindings: ["read", "write", "delete"],
  prompts: ["read", "write", "publish"],
  knowledge: ["read", "write", "publish"],
  messages: ["read"],
  audit: ["read"],
  users: ["read", "write", "delete"],
  assignments: ["read", "write", "delete"],
  hardDelete: ["delete"],
};

const ADMIN_PERMISSIONS: PermissionMap = {
  ...OWNER_PERMISSIONS,
};

const OPERATOR_PERMISSIONS: PermissionMap = {
  overview: ["read"],
  todos: ["read", "write"],
  templates: ["read", "write"],
  bindings: ["read"],
  prompts: ["read", "write"],
  knowledge: ["read", "write"],
  messages: ["read"],
  audit: ["read"],
  users: [],
  assignments: [],
  hardDelete: [],
};

const VIEWER_PERMISSIONS: PermissionMap = {
  overview: ["read"],
  todos: ["read"],
  templates: ["read"],
  bindings: ["read"],
  prompts: ["read"],
  knowledge: ["read"],
  messages: ["read"],
  audit: ["read"],
  users: [],
  assignments: [],
  hardDelete: [],
};

const ROLE_MATRIX: Record<StaffRole, PermissionMap> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  operator: OPERATOR_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

export function canRole(
  role: StaffRole,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  return ROLE_MATRIX[role][resource].includes(action);
}

export function isAdminRole(role: StaffRole): boolean {
  return role === "owner" || role === "admin";
}
