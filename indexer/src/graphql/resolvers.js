const jwt = require('jsonwebtoken');
const { ROLES, JWT_SECRET, enforceRole, isOwner } = require('./auth');
const { queryAll, queryGet, queryRun } = require('./db');

const resolvers = {
  Query: {
    me: (parent, args, context) => {
      if (context.user.role === ROLES.ANONYMOUS) return null;
      return context.user;
    },
    tasks: async (parent, { limit = 50, offset = 0 }, context) => {
      return queryAll('SELECT * FROM tasks LIMIT ? OFFSET ?', [limit, offset]);
    },
    task: async (parent, { id }, context) => {
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
    },
    events: async (parent, { task_id, limit = 50, offset = 0 }, context) => {
      if (task_id !== undefined) {
        return queryAll('SELECT * FROM events WHERE task_id = ? ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?', [task_id, limit, offset]);
      }
      return queryAll('SELECT * FROM events ORDER BY ledger_sequence DESC LIMIT ? OFFSET ?', [limit, offset]);
    },
    reconciliationLogs: async (parent, { task_id, limit = 50, offset = 0 }, context) => {
      // Role-based access control: Only Operator and Admin can view reconciliation logs
      enforceRole(context, ROLES.OPERATOR);
      
      if (task_id !== undefined) {
        return queryAll('SELECT * FROM reconciliation_logs WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [task_id, limit, offset]);
      }
      return queryAll('SELECT * FROM reconciliation_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    }
  },
  
  Mutation: {
    loginDemo: (parent, { address, role }) => {
      // For demo purposes, allow token generation.
      const userRole = role || ROLES.USER;
      const user = {
        id: `usr_${Math.random().toString(36).substr(2, 9)}`,
        address,
        role: userRole
      };
      
      const token = jwt.sign(user, JWT_SECRET, { expiresIn: '1d' });
      return { token, user };
    },
    pauseTask: async (parent, { id }, context) => {
      const task = await queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
      if (!task) throw new Error("Task not found");
      
      // Complex Authorization: Admin can pause any task. User can only pause their own task.
      if (context.user.role !== ROLES.ADMIN && !isOwner(context, task.creator)) {
        throw new Error("Unauthorized: Only Admin or the task Creator can pause this task.");
      }
      
      await queryRun('UPDATE tasks SET is_active = 0 WHERE task_id = ?', [id]);
      return queryGet('SELECT * FROM tasks WHERE task_id = ?', [id]);
    }
  },
  
  // Field-level Authorization for Task type
  Task: {
    whitelist_json: (task, args, context) => {
      // Only Admin or the Creator can view the whitelist
      if (context.user.role === ROLES.ADMIN || isOwner(context, task.creator)) {
        return task.whitelist_json;
      }
      return null;
    },
    blocked_by_json: (task, args, context) => {
      // Only Admin or the Creator can view block reasons
      if (context.user.role === ROLES.ADMIN || isOwner(context, task.creator)) {
        return task.blocked_by_json;
      }
      return null;
    }
  }
};

module.exports = { resolvers };
