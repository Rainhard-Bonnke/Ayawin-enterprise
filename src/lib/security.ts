export type NetworkScopeRule = {
  cidr: string;
  description?: string | null;
  role_name?: string | null;
  user_name?: string | null;
};

export function describeNetworkScope(rule: NetworkScopeRule): string {
  const parts = [rule.cidr];
  if (rule.role_name) parts.push(rule.role_name);
  if (rule.user_name) parts.push(rule.user_name);
  if (rule.description) parts.push(rule.description);
  return parts.join(" • ");
}

export type SessionDeviceSummary = {
  session_type?: string | null;
  device_info?: string | null;
  ip_address?: string | null;
};

export function describeSessionDevice(session: SessionDeviceSummary): string {
  const parts = [] as string[];
  const device = session.device_info?.trim();
  if (device) parts.push(device);
  if (session.ip_address) parts.push(session.ip_address);
  return parts.join(" • ");
}
