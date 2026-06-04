const { ROLES, enforceRole, createContext, isOwner } = require('../auth');

describe('GraphQL Auth Module', () => {
  it('should enforce roles correctly', () => {
    // Admin context
    const adminCtx = { user: { role: ROLES.ADMIN } };
    expect(() => enforceRole(adminCtx, ROLES.OPERATOR)).not.toThrow();
    expect(() => enforceRole(adminCtx, ROLES.USER)).not.toThrow();

    // User context
    const userCtx = { user: { role: ROLES.USER } };
    expect(() => enforceRole(userCtx, ROLES.ADMIN)).toThrow('Unauthorized: Requires ADMIN access level.');
    expect(() => enforceRole(userCtx, ROLES.OPERATOR)).toThrow('Unauthorized: Requires OPERATOR access level.');
    expect(() => enforceRole(userCtx, ROLES.USER)).not.toThrow();
  });

  it('should identify owner correctly', () => {
    const ctx = { user: { address: 'G_TEST_ADDRESS' } };
    expect(isOwner(ctx, 'G_TEST_ADDRESS')).toBe(true);
    expect(isOwner(ctx, 'G_OTHER_ADDRESS')).toBe(false);
  });

  it('should create context from token', () => {
    // Test context without token
    const emptyCtx = createContext({ req: { headers: {} } });
    expect(emptyCtx.user.role).toBe(ROLES.ANONYMOUS);
  });
});
