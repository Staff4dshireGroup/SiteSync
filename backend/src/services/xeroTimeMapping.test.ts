import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildXeroProjectName,
  durationMinutes,
  extractJobCode,
  mapTimeEntryToXero,
  matchXeroProjectsByJobCode,
  resolveXeroUser,
  XERO_TIME_MAX_MINUTES,
} from './xeroTimeMapping';

const signIn = new Date('2026-11-04T08:00:00.000Z');
const signOut = new Date('2026-11-04T16:30:00.000Z');

function baseInput(overrides: Partial<Parameters<typeof mapTimeEntryToXero>[0]> = {}) {
  return {
    timeEntryId: 'entry-1',
    signInAt: signIn,
    signOutAt: signOut,
    approvedAt: new Date('2026-11-04T17:00:00.000Z'),
    staffName: 'Jane Doe',
    staffEmail: 'jane@example.com',
    projectName: 'Sp1166 - 12 High Street',
    xeroProjectId: 'proj-1',
    xeroUserId: 'user-1',
    xeroTaskId: 'task-1',
    userMatch: 'email' as const,
    alreadySynced: false,
    travelMinutes: 25,
    travelMiles: 12.4,
    ...overrides,
  };
}

describe('job codes', () => {
  it('reads Sp/Sc/Sf/Sg/Is prefixes and keeps canonical case', () => {
    assert.equal(extractJobCode('Sp1166 - 12 High Street'), 'Sp1166');
    assert.equal(extractJobCode('sc1166 somewhere'), 'Sc1166');
    assert.equal(extractJobCode('Sf8'), 'Sf8');
    assert.equal(extractJobCode('prefix Sg10 end'), 'Sg10');
    assert.equal(extractJobCode('Is900 - yard'), 'Is900');
  });

  it('does not treat ordinary words as job codes', () => {
    assert.equal(extractJobCode('This is 12 metres'), null);
    assert.equal(extractJobCode('Special project'), null);
    assert.equal(extractJobCode('xSp1166'), null);
  });

  it('matches one Xero project and leaves ambiguous codes unmatched', () => {
    const projects = [
      { projectId: 'a', name: 'Sp1166 - 12 High Street' },
      { projectId: 'b', name: 'Sc200 - other' },
      { projectId: 'c', name: 'Sp1166 - duplicate site' },
    ];
    const unique = matchXeroProjectsByJobCode({ name: 'sp1166', address: '12 High Street' }, [
      projects[0],
      projects[1],
    ]);
    assert.equal(unique.code, 'Sp1166');
    assert.deepEqual(unique.matches.map((row) => row.projectId), ['a']);

    const ambiguous = matchXeroProjectsByJobCode({ name: 'Sp1166' }, projects);
    assert.equal(ambiguous.matches.length, 2);

    const none = matchXeroProjectsByJobCode({ name: 'Kitchen refit' }, projects);
    assert.equal(none.code, null);
    assert.equal(none.matches.length, 0);
  });
});

describe('Xero project names', () => {
  it('builds Sp1166 - address when the code and address are separate', () => {
    assert.equal(
      buildXeroProjectName({ name: 'Sp1166', address: '12 High Street' }),
      'Sp1166 - 12 High Street'
    );
  });

  it('keeps a name that already contains the address', () => {
    assert.equal(
      buildXeroProjectName({ name: 'Sp1166 - 12 High Street', address: '12 High Street' }),
      'Sp1166 - 12 High Street'
    );
  });

  it('uses a code found only on the address', () => {
    assert.equal(buildXeroProjectName({ name: 'Kitchen', address: 'Is44 Yard' }), 'Is44 - Yard');
  });

  it('appends the address when there is no job code', () => {
    assert.equal(
      buildXeroProjectName({ name: 'Kitchen', address: '12 High Street' }),
      'Kitchen - 12 High Street'
    );
  });
});

describe('time entry mapping', () => {
  it('maps an approved shift to a Xero time body in minutes', () => {
    assert.equal(durationMinutes(signIn, signOut), 510);
    const mapped = mapTimeEntryToXero(baseInput());
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.idempotencyKey, 'entry-1');
    assert.equal(mapped.body.duration, 510);
    assert.equal(mapped.body.dateUtc, signIn.toISOString());
    assert.equal(mapped.body.userId, 'user-1');
    assert.equal(mapped.body.taskId, 'task-1');
    assert.match(mapped.body.description, /Jane Doe/);
    assert.match(mapped.body.description, /jane@example.com/);
    assert.match(mapped.body.description, /Travel 25 min, 12.4 mi/);
  });

  it('rounds a sub-minute shift up to 1 minute and rejects zero or huge durations', () => {
    const tinyOut = new Date(signIn.getTime() + 20_000);
    assert.equal(durationMinutes(signIn, tinyOut), 1);
    const tiny = mapTimeEntryToXero(baseInput({ signOutAt: tinyOut }));
    assert.equal(tiny.ok, true);
    if (tiny.ok) assert.equal(tiny.body.duration, 1);

    const zero = mapTimeEntryToXero(baseInput({ signOutAt: signIn }));
    assert.equal(zero.ok, false);
    if (!zero.ok) assert.equal(zero.error, 'Duration is zero');

    const huge = mapTimeEntryToXero(
      baseInput({ signOutAt: new Date(signIn.getTime() + (XERO_TIME_MAX_MINUTES + 1) * 60_000) })
    );
    assert.equal(huge.ok, false);
    if (!huge.ok) assert.match(huge.error, /exceeds Xero/);
  });

  it('skips duplicates, open shifts, unapproved rows, and unlinked projects', () => {
    const duplicate = mapTimeEntryToXero(baseInput({ alreadySynced: true }));
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.status, 'skipped');

    const open = mapTimeEntryToXero(baseInput({ signOutAt: null }));
    assert.equal(open.ok, false);
    if (!open.ok) assert.match(open.error, /open/);

    const unapproved = mapTimeEntryToXero(baseInput({ approvedAt: null }));
    assert.equal(unapproved.ok, false);
    if (!unapproved.ok) assert.match(unapproved.error, /not approved/);

    const unlinked = mapTimeEntryToXero(baseInput({ xeroProjectId: null }));
    assert.equal(unlinked.ok, false);
    if (!unlinked.ok) assert.equal(unlinked.status, 'skipped');
  });

  it('fails when there is no Xero user or task', () => {
    const noUser = mapTimeEntryToXero(baseInput({ xeroUserId: null }));
    assert.equal(noUser.ok, false);
    if (!noUser.ok) assert.equal(noUser.status, 'failed');

    const noTask = mapTimeEntryToXero(baseInput({ xeroTaskId: null }));
    assert.equal(noTask.ok, false);
    if (!noTask.ok) assert.match(noTask.error, /task/);
  });

  it('matches staff by email and otherwise uses the default Xero user', () => {
    const users = [
      { userId: 'u1', email: 'Jane@Example.com', name: 'Jane' },
      { userId: 'u2', email: 'other@example.com', name: 'Other' },
    ];
    const byEmail = resolveXeroUser({ staffEmail: 'jane@example.com', xeroUsers: users, defaultUserId: 'fallback' });
    assert.deepEqual(byEmail, { ok: true, userId: 'u1', matchedBy: 'email' });

    const fallback = resolveXeroUser({
      staffEmail: 'missing@example.com',
      xeroUsers: users,
      defaultUserId: 'fallback',
    });
    assert.deepEqual(fallback, { ok: true, userId: 'fallback', matchedBy: 'default' });

    const none = resolveXeroUser({ staffEmail: 'missing@example.com', xeroUsers: users, defaultUserId: null });
    assert.equal(none.ok, false);
  });
});
