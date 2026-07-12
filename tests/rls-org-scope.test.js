const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function currentRequestOrganization(jwtOrg) {
  return jwtOrg === 'hisolar' || jwtOrg === 'jdk' ? jwtOrg : null;
}

function isActiveMembership(memberships, jwtOrg, requiredOrg) {
  return currentRequestOrganization(jwtOrg) === requiredOrg
    && memberships.some(item => item.organization === requiredOrg && item.status === 'approved');
}

function hasMembershipRole(memberships, jwtOrg, requiredOrg, allowedRoles) {
  return currentRequestOrganization(jwtOrg) === requiredOrg
    && memberships.some(item =>
      item.organization === requiredOrg
      && item.status === 'approved'
      && allowedRoles.includes(item.role)
    );
}

function isJdkJobScope(sheetKey) {
  return ['ngan', 'langPaeng', 'som'].includes(sheetKey);
}

function canReadJobSheet(memberships, jwtOrg, sheetKey) {
  return isActiveMembership(memberships, jwtOrg, 'hisolar')
    || (isActiveMembership(memberships, jwtOrg, 'jdk') && isJdkJobScope(sheetKey));
}

function canInsertJob(memberships, jwtOrg, sheetKey) {
  return currentRequestOrganization(jwtOrg) === 'hisolar'
    && hasMembershipRole(memberships, jwtOrg, 'hisolar', ['admin', 'member'])
    && ['ngan', 'duNgan', 'langPaeng', 'som', 'bil'].includes(sheetKey);
}

function canUpdateJob(memberships, jwtOrg, sheetKey) {
  return canInsertJob(memberships, jwtOrg, sheetKey);
}

function canReadPermits(memberships, jwtOrg) {
  return currentRequestOrganization(jwtOrg) === 'hisolar'
    && hasMembershipRole(memberships, jwtOrg, 'hisolar', ['admin', 'member']);
}

function canInsertComment(memberships, jwtOrg, sheetKey) {
  return (
    hasMembershipRole(memberships, jwtOrg, 'hisolar', ['admin', 'member'])
    && canReadJobSheet(memberships, jwtOrg, sheetKey)
  ) || (
    hasMembershipRole(memberships, jwtOrg, 'jdk', ['admin', 'commenter'])
    && isJdkJobScope(sheetKey)
  );
}

test('RLS org-scope migration binds helper functions and affected policies to current_request_organization', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'line-auth-org-scope.sql'),
    'utf8'
  );
  const rollback = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'line-auth-org-scope-rollback.sql'),
    'utf8'
  );

  assert.match(
    migration,
    /create or replace function public\.is_active_membership\(required_org text\)[\s\S]*required_org = public\.current_request_organization\(\)/s
  );
  assert.match(
    migration,
    /create or replace function public\.has_membership_role\(required_org text, allowed_roles text\[\]\)[\s\S]*required_org = public\.current_request_organization\(\)/s
  );
  assert.match(
    migration,
    /create policy "Authenticated update jobs hisolar admin member"[\s\S]*public\.current_request_organization\(\) = 'hisolar'/s
  );
  assert.match(
    migration,
    /create policy "Authenticated read permits hisolar admin member"[\s\S]*public\.current_request_organization\(\) = 'hisolar'/s
  );
  assert.match(
    migration,
    /create policy "Authenticated insert access_requests self pending"[\s\S]*requested_organization = public\.current_request_organization\(\)/s
  );
  assert.match(
    migration,
    /create policy "Authenticated update app_memberships org admin"[\s\S]*organization = public\.current_request_organization\(\)/s
  );
  assert.match(
    migration,
    /create policy "Authenticated insert comments by membership"[\s\S]*organization = public\.current_request_organization\(\)/s
  );
  assert.match(
    migration,
    /create policy "Authenticated read job logs by membership"[\s\S]*public\.can_read_job_log\(job_id, sheet_key\)/s
  );
  assert.match(
    migration,
    /create policy "Authenticated read permit logs hisolar admin member"[\s\S]*public\.current_request_organization\(\) = 'hisolar'/s
  );
  assert.match(
    migration,
    /create policy "Authenticated insert permit logs hisolar admin member"[\s\S]*public\.current_request_organization\(\) = 'hisolar'/s
  );

  assert.doesNotMatch(
    rollback,
    /required_org = public\.current_request_organization\(\)/,
    'rollback should restore the pre-scope helper behavior'
  );
});

test('dual-membership JDK token cannot perform Hi Solar direct REST actions', () => {
  const memberships = [
    { organization: 'hisolar', role: 'member', status: 'approved' },
    { organization: 'jdk', role: 'commenter', status: 'approved' },
  ];

  assert.equal(canUpdateJob(memberships, 'jdk', 'ngan'), false);
  assert.equal(canReadPermits(memberships, 'jdk'), false);
  assert.equal(canReadJobSheet(memberships, 'jdk', 'ngan'), true);
  assert.equal(canReadJobSheet(memberships, 'jdk', 'duNgan'), false);
  assert.equal(canInsertComment(memberships, 'jdk', 'som'), true);
  assert.equal(canInsertComment(memberships, 'jdk', 'duNgan'), false);
});

test('Hi Solar token keeps Hi Solar role permissions only', () => {
  const memberships = [
    { organization: 'hisolar', role: 'member', status: 'approved' },
    { organization: 'jdk', role: 'commenter', status: 'approved' },
  ];

  assert.equal(canUpdateJob(memberships, 'hisolar', 'duNgan'), true);
  assert.equal(canReadPermits(memberships, 'hisolar'), true);
  assert.equal(canInsertComment(memberships, 'hisolar', 'duNgan'), true);
});

test('suspended membership is denied immediately from database-backed checks', () => {
  const memberships = [
    { organization: 'hisolar', role: 'member', status: 'suspended' },
    { organization: 'jdk', role: 'commenter', status: 'approved' },
  ];

  assert.equal(canUpdateJob(memberships, 'hisolar', 'ngan'), false);
  assert.equal(canReadPermits(memberships, 'hisolar'), false);
  assert.equal(canInsertComment(memberships, 'hisolar', 'ngan'), false);
  assert.equal(canInsertComment(memberships, 'jdk', 'ngan'), true);
});
