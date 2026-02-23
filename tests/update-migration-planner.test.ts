import { describe, expect, it } from 'vitest';
import { UpdateMigrationPlanner } from '@main/services/update/UpdateMigrationPlanner';

describe('UpdateMigrationPlanner', () => {
  it('aceita no-op quando versoes sao iguais', () => {
    const planner = new UpdateMigrationPlanner();
    const plan = planner.plan(1, 1);

    expect(plan.supported).toBe(true);
    expect(plan.required).toBe(false);
    expect(plan.steps).toHaveLength(0);
  });

  it('bloqueia downgrade de schema', () => {
    const planner = new UpdateMigrationPlanner();
    const plan = planner.plan(2, 1);

    expect(plan.supported).toBe(false);
    expect(plan.blockedReason).toContain('Downgrade');
  });

  it('bloqueia upgrade sem migracao registrada', () => {
    const planner = new UpdateMigrationPlanner();
    const plan = planner.plan(2, 3);

    expect(plan.supported).toBe(false);
    expect(plan.required).toBe(true);
    expect(plan.blockedReason).toContain('2 -> 3');
  });

  it('planeja migracao registrada 1 -> 2', () => {
    const planner = new UpdateMigrationPlanner();
    const plan = planner.plan(1, 2);

    expect(plan.supported).toBe(true);
    expect(plan.required).toBe(true);
    expect(plan.steps).toEqual([
      {
        fromVersion: 1,
        toVersion: 2,
        id: 'permissions-policy-shape-v2'
      }
    ]);
  });
});
