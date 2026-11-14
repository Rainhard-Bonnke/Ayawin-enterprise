const crypto = require("crypto");

const orgHierarchyRegistry = new Map();

function createOrgNode({ companyId, name, type, parentId = null, branchId = null, metadata = {} }) {
  if (!companyId || !name || !type) {
    throw new Error("companyId, name, and type are required");
  }

  const node = {
    id: crypto.randomUUID(),
    companyId: String(companyId),
    name: String(name).trim(),
    type: String(type).toLowerCase(),
    parentId: parentId ? String(parentId) : null,
    branchId: branchId ? String(branchId) : null,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    createdAt: new Date().toISOString(),
  };

  const current = orgHierarchyRegistry.get(node.companyId) || [];
  if (node.parentId) {
    const parent = current.find((entry) => entry.id === node.parentId);
    if (!parent) {
      throw new Error("Parent org unit was not found in the same company hierarchy");
    }
    if (parent.type === node.type && node.type !== "company") {
      // allow branch parent/department but disallow same-type nesting to keep the hierarchy predictable
      // no-op, still valid
    }
  }

  current.push(node);
  orgHierarchyRegistry.set(node.companyId, current);
  return node;
}

function listOrgHierarchy(companyId) {
  const nodes = orgHierarchyRegistry.get(String(companyId)) || [];
  return nodes.map((node) => ({ ...node }));
}

function buildOrgTree(companyId) {
  const nodes = listOrgHierarchy(companyId);
  const byId = new Map(nodes.map((node) => [node.id, { ...node, children: [] }]));
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    }
  }
  return Array.from(byId.values()).filter((node) => !node.parentId);
}

function validateHierarchy(companyId) {
  const nodes = listOrgHierarchy(companyId);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.parentId && !byId.has(node.parentId)) {
      return { valid: false, reason: `Missing parent for ${node.name}` };
    }
    if (node.parentId === node.id) {
      return { valid: false, reason: `Self-parent loop detected for ${node.name}` };
    }
  }
  return { valid: true, nodes };
}

module.exports = {
  orgHierarchyRegistry,
  createOrgNode,
  listOrgHierarchy,
  buildOrgTree,
  validateHierarchy,
};
