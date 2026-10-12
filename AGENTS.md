AGENTS.md

1. Project Purpose

This repository contains the SIPRESISI TIK web application, a Node.js/Express-based information system for managing official letters, approvals, dispositions, archives, reports, users, activity logs, and document generation.

The application currently works, but much of the backend logic is concentrated in app.js. The primary engineering goal is to improve project structure and maintainability without changing existing application behavior.

This is a refactoring project, not a rewrite.

2. Mandatory First Step for Every Task

Before modifying any code:

Read this AGENTS.md completely.

Inspect the actual repository structure.

Read package.json.

Read the relevant sections of app.js.

Inspect every existing file related to the requested feature.

Trace imports, exports, route registrations, middleware order, database access, view dependencies, file paths, and frontend calls.

Search the workspace for duplicate or legacy implementations before creating new files.

Do not assume that a file is unused merely because app.js currently contains similar logic.

Explain the planned change briefly before performing a large refactor.

Prefer the smallest safe change.

Never refactor based only on file names or assumptions.

3. Current Technology Stack

The current project uses:

Node.js

CommonJS (require / module.exports)

Express 5

EJS

MySQL

mysql2

JWT authentication

cookie-based token storage

bcryptjs

cookie-parser

cors

helmet

multer

docx

docxtemplater

docxtemplater-image-module-free

pizzip

pdfkit

puppeteer

dotenv

Nodemon for development

Do not migrate the repository to TypeScript, ES Modules, another framework, another ORM, or another template engine unless explicitly requested.

4. Known Application Areas

The application contains at least these functional areas:

Authentication

login

logout

JWT verification

role-based redirect behavior

active/inactive user validation

Staff

dashboard

create/edit letters

submit letters

delete draft/rejected letters

archive/search

profile management

password management

disposition/task inbox

completing disposition tasks

Admin

dashboard

user management

letter type management

template management

archive

incoming letter entry

logs/activity history

Pimpinan

dashboard

letter details

approval

rejection

disposition

history

reports

profile

Documents

DOCX templates

DOCX generation

PDF generation

uploaded PDF/DOCX files

generated files stored under project/public upload locations

Supporting Features

activity logging

letter numbering

Roman month formatting

pagination

filtering/search

database queries

Before moving any feature, find all code and frontend references connected to it.

5. Current Structural Problem

app.js is currently oversized and mixes multiple responsibilities, including:

Express application initialization

middleware configuration

database initialization/access

authentication

route definitions

SQL queries

business rules

activity logging

upload configuration

document generation

file-system operations

response rendering

administrative logic

staff logic

pimpinan logic

helper functions

The goal is to gradually reduce app.js into an application/bootstrap composition layer.

Do not attempt to split the entire file in one change.

6. Existing Project Structure Must Be Respected

The repository already contains files/folders such as:

routes/

authRoutes.js

dashboardRoutes.js

letterRoutes.js

logRoutes.js

typeRoutes.js

userRoutes.js

utils/logger.js

views/admin/

views/staff/

views/pimpinan/

views/partials/

uploads/templates/

seed files

database.js

These existing files may already contain modular implementations, legacy implementations, partially integrated code, or duplicated logic.

Therefore:

inspect them before creating replacements;

do not create duplicate route/controller/service files just because similar logic exists in app.js;

determine whether the existing file is active, stale, incomplete, or unused;

preserve useful existing code where possible;

if consolidating duplicate implementations, prove which implementation is currently used before deleting anything.

Never delete an existing route/module only because another implementation looks cleaner.

7. Target Architecture

Move toward this architecture gradually:

project-root/
|
|-- app.js
|-- database.js
|-- package.json
|
|-- routes/
|   |-- authRoutes.js
|   |-- staffRoutes.js
|   |-- adminRoutes.js
|   |-- pimpinanRoutes.js
|   |-- letterRoutes.js
|   |-- userRoutes.js
|   |-- typeRoutes.js
|   `-- logRoutes.js
|
|-- controllers/
|   |-- authController.js
|   |-- staffController.js
|   |-- adminController.js
|   |-- pimpinanController.js
|   |-- letterController.js
|   |-- userController.js
|   |-- typeController.js
|   `-- logController.js
|
|-- services/
|   |-- authService.js
|   |-- letterService.js
|   |-- documentService.js
|   |-- dispositionService.js
|   |-- reportService.js
|   `-- activityLogService.js
|
|-- middleware/
|   |-- authMiddleware.js
|   |-- roleMiddleware.js
|   |-- uploadMiddleware.js
|   `-- errorMiddleware.js
|
|-- repositories/
|   |-- userRepository.js
|   |-- letterRepository.js
|   |-- dispositionRepository.js
|   |-- letterTypeRepository.js
|   `-- activityLogRepository.js
|
|-- utils/
|   |-- logger.js
|   |-- letterNumber.js
|   `-- dateUtils.js
|
|-- views/
|-- public/
|-- uploads/
`-- seeds/

This is a direction, not a requirement to create every folder immediately.

Only introduce a layer when it provides clear value.

Avoid overengineering.

For small/simple queries, direct database access from a controller may temporarily be acceptable during incremental migration. Prefer repositories/services for repeated, complex, transactional, or business-critical logic.

8. Responsibility Rules

app.js

The long-term responsibility of app.js should be limited mainly to:

loading environment configuration;

creating the Express app;

registering global middleware;

configuring EJS/static assets;

mounting route modules;

registering final error handling;

starting the HTTP server, if this repository keeps server startup in app.js.

Do not add new substantial business logic to app.js.

If adding a new feature, prefer the appropriate route/controller/service/module instead.

Routes

Route files should primarily:

declare URL paths;

declare HTTP methods;

apply middleware;

connect requests to controllers.

Avoid large SQL queries and large business logic blocks inside route files.

Controllers

Controllers should primarily:

read request parameters/body/query;

call the appropriate service/repository;

choose HTTP responses or EJS views;

map errors into existing response behavior.

Do not put complex document-generation logic or large reusable workflows directly inside controllers when they can be moved to services.

Services

Services should contain reusable business workflows such as:

letter approval/rejection rules;

letter numbering;

document generation;

disposition workflows;

report preparation;

authentication workflows;

activity logging where appropriate.

Repositories

Repositories should contain reusable MySQL query operations.

Do not introduce an ORM unless explicitly requested.

Middleware

Middleware should contain cross-cutting HTTP behavior such as:

JWT authentication;

role authorization;

upload validation;

centralized error handling.

Utils

Utilities must be small, generic, and side-effect-light.

Do not turn utils/ into a dumping ground for business logic.

9. Refactoring Strategy

Refactor incrementally by feature/domain.

Preferred sequence:

database connection consistency

authentication middleware and auth routes

activity logging

simple user/type/log routes

staff profile routes

letter CRUD

staff dashboard/archive

disposition workflow

admin features

pimpinan approval/rejection

document/template generation

reports/PDF/DOCX generation

final cleanup of app.js

Each step must leave the application runnable.

Do not refactor multiple large domains in one step unless explicitly requested.

10. Behavior Preservation Rules

During structural refactoring, preserve all externally visible behavior unless explicitly requested otherwise.

Do not silently change:

route URLs;

HTTP methods;

request body field names;

query parameter names;

response JSON keys;

HTTP status codes;

redirects;

EJS view names;

variables passed to EJS views;

authentication cookie name;

JWT payload fields;

letter status values;

role names;

database column names;

template filenames;

upload locations;

generated document names;

pagination behavior;

filtering/search behavior;

existing Indonesian UI/error messages.

If a behavior looks inconsistent or buggy, report it separately instead of "fixing" it as part of a pure refactor.

11. Authentication and Authorization Safety

Authentication is sensitive.

Current authentication behavior uses JWT and a cookie named token.

When refactoring:

preserve the token cookie unless explicitly requested otherwise;

preserve JWT payload fields required elsewhere;

preserve current redirect behavior;

preserve account active/inactive checks;

preserve password hashing with bcrypt;

never log plaintext passwords;

never return password hashes to clients intentionally;

never hard-code new secrets;

use environment variables for secrets;

do not weaken authentication merely to make tests easier.

Important

Authentication and authorization are different.

A valid token does not automatically prove that a user is allowed to access every admin/staff/pimpinan endpoint.

While auditing, identify routes that only use authentication but appear to require role authorization.

Do not silently change authorization behavior during a structural refactor. Report security findings separately and propose them as an explicit follow-up.

12. Database Rules

The project uses MySQL through mysql2.

A dedicated database.js already exists and creates a connection pool using environment variables.

Prefer converging toward a single shared database module instead of creating independent connections in multiple files.

However, because current app.js also contains its own database connection logic, migration must be done carefully.

Before changing database access:

inspect every import/use of database.js;

inspect callback-style db.query(...) usages;

inspect promise-style queries;

understand whether the exported database object is a pool, promise pool, or connection;

do not bulk-convert callback queries to async/await in the same step as architectural movement unless necessary;

keep SQL behavior identical during structural extraction;

preserve transaction semantics where present;

keep parameterized queries;

never concatenate untrusted input into SQL where parameters can be used.

Do not change the database schema during refactoring unless explicitly requested.

Do not rename tables/columns merely for style.

Known domain tables referenced by the application include concepts such as:

users

letters

letter_types

dispositions

activity_logs

Inspect the actual schema/code before assuming full table structure.

13. Database Credentials and Environment Files

Never expose secrets.

Do not print, commit, or copy into documentation:

database passwords;

JWT secrets;

private credentials;

production tokens.

.env should remain ignored by Git.

If environment documentation is needed, use placeholders such as:

DB_HOST=localhost
DB_USER=your_user
DB_PASSWORD=your_password
DB_PORT=3306
JWT_SECRET=your_secret
PORT=3000

Do not replace working user credentials automatically.

14. File Upload and Document Rules

The application handles PDF and DOC/DOCX content and generates documents.

Be conservative when modifying this area.

Preserve:

accepted file types;

current file size behavior unless explicitly changed;

existing template lookup logic;

file naming behavior;

upload directories;

download/preview endpoints;

document placeholders;

formatting required by templates.

Before modifying document-generation code, inspect:

EJS/frontend code that triggers it;

public/uploads;

template directories;

database fields storing file/template paths;

DOCX/PDF libraries used by that flow.

Do not delete user-generated files during refactoring.

Do not move upload directories without migrating all references.

Do not overwrite templates destructively without an explicit task.

15. Views and Frontend Contract

The frontend uses EJS and static assets.

Known view areas include:

views/login.ejs

views/admin/

views/staff/

views/pimpinan/

views/partials/

Before changing an endpoint, search EJS and frontend JavaScript for references to that endpoint.

Preserve the object keys used by views.

For example, if a view currently receives:

res.render('staff/dashboard', {
    title,
    page,
    user,
    stats,
    letters
});

do not rename or remove those keys during a structural refactor unless every consumer is intentionally updated and behavior is verified.

Do not redesign UI while performing backend-structure refactoring unless explicitly requested.

16. Role Names Are Domain Contracts

Existing roles include:

admin

staff

pimpinan

Treat these strings as domain contracts.

Do not rename them to terms such as:

administrator

employee

leader

manager

unless explicitly requested and accompanied by a complete migration plan.

17. Letter Statuses Are Domain Contracts

Existing code uses letter/disposition statuses such as:

DRAFT

PENDING

APPROVED

REJECTED

COMPLETED

Do not rename, translate, normalize, or re-case these statuses during refactoring.

Before adding a new status, inspect the full workspace for every status-dependent condition in:

SQL;

EJS;

JavaScript;

reports;

dashboards;

document generation.

18. Error Handling

Maintain current user-facing behavior while extracting code.

During pure refactoring:

preserve current status codes;

preserve JSON response keys;

preserve redirect destinations;

preserve user-facing messages when practical.

Do not replace all errors with a generic abstraction in one large change.

A centralized error handler may be introduced gradually after existing behavior is mapped.

Log enough server-side information to debug failures, but do not log secrets.

19. Activity Logging

The application records activity such as login, letter creation, submission, approval, rejection, deletion, and task completion.

Activity logging is functional behavior, not optional debug output.

When extracting routes/controllers:

preserve logActivity calls and their timing;

preserve user IDs;

preserve action names;

preserve useful descriptions;

preserve IP-address capture behavior unless intentionally improved later.

Do not accidentally remove activity logs while moving business logic.

20. Letter Numbering

Letter-number generation is business-critical.

Do not rewrite numbering logic merely for style.

Before modifying it:

inspect letter_types.code_prefix;

inspect letter_number_format;

inspect Roman-month handling;

inspect how the current year is applied;

inspect how the next sequence number is determined;

inspect approval flow;

inspect existing persisted letter numbers.

Any change to numbering must be treated as a functional change and tested separately.

21. Existing Duplicate/Inconsistent Code

Because the application evolved through rapid/vibe coding, duplicated or inconsistent logic may exist.

Examples may include:

database connection logic in more than one place;

route logic in both app.js and routes/;

multiple profile update endpoints;

mixed callback and promise database access;

similar helper functions in multiple files;

files that look modular but are not currently mounted.

When duplication is found:

identify all copies;

determine which one is executed;

compare behavior;

choose a canonical implementation;

migrate references incrementally;

only delete old code after proving it is no longer reachable.

Do not delete duplicates on sight.

22. Code Style

Follow the project's current JavaScript style unless changing it clearly improves consistency.

Use:

CommonJS;

clear names;

small functions;

early returns where useful;

parameterized SQL;

comments only where they add real context.

Avoid:

unnecessary abstractions;

deeply generic frameworks;

premature dependency injection containers;

unnecessary classes;

mass formatting unrelated files;

converting every callback solely for style;

introducing new dependencies for trivial tasks.

A refactor should reduce complexity, not move it elsewhere.

23. Dependency Rules

Before adding an npm dependency:

confirm existing dependencies cannot solve the problem reasonably;

explain why the new dependency is necessary;

prefer maintained and well-known packages;

avoid adding architectural libraries during a simple refactor.

Do not upgrade package versions during structural refactoring unless required by the task.

Do not run broad automated dependency upgrades.

24. Verification Commands

The current package scripts include:

npm start
npm run dev

npm start runs:

node app.js

npm run dev runs:

nodemon app.js

There is currently no known automated test script in package.json.

Therefore, do not claim "all tests pass" unless actual tests exist and were run.

After each refactor, at minimum:

run a JavaScript syntax check on changed .js files where practical;

start the application if the environment permits;

inspect server startup errors;

verify changed imports/exports;

verify route registration;

verify middleware order;

verify referenced views/files exist;

verify SQL placeholders match parameter arrays;

report anything that could not be verified because database/runtime dependencies are unavailable.

Useful checks include:

node --check app.js
npm start

For extracted files, run:

node --check path/to/file.js

Do not state that a database-backed flow works unless it was actually exercised or its limitation is clearly stated.

25. Route Verification Checklist

Whenever moving a route out of app.js, verify all of the following:

original HTTP method;

original URL;

middleware;

middleware order;

request parameters;

body fields;

query parameters;

database queries;

status codes;

redirects;

JSON keys;

rendered view;

data passed to the view;

activity log behavior;

file upload behavior;

downstream frontend references.

A moved route is not complete merely because the server starts.

26. Refactoring One Domain at a Time

For a requested refactor, use this workflow:

Phase A — Audit

Report:

relevant current routes;

relevant functions/helpers;

relevant SQL;

relevant views;

relevant frontend references;

relevant files;

dependencies;

duplication found;

risk areas.

Do not modify files during audit if the user asked for analysis only.

Phase B — Plan

Propose:

files to create;

files to modify;

code to move;

code to leave temporarily;

behavior that must remain identical;

verification steps.

Phase C — Implement

Make the smallest coherent refactor.

Do not opportunistically refactor unrelated modules.

Phase D — Verify

Check syntax, startup, imports, routes, and behavior that can be tested.

Phase E — Report

State:

files changed;

what moved;

what behavior was intentionally preserved;

what remains in app.js;

unresolved issues;

suggested next refactor step.

27. Git Safety

Before a large refactor, inspect Git status when available.

Do not overwrite unrelated user changes.

Do not automatically discard uncommitted modifications.

Do not use destructive Git operations such as:

git reset --hard
git clean -fd

unless explicitly requested by the user and the consequences are understood.

Prefer changes that can be reviewed in small diffs.

28. Files and Directories That Must Not Be Treated as Source Code

Do not inspect or modify dependency internals under:

node_modules/

unless debugging a dependency itself is explicitly required.

Do not include node_modules when summarizing project architecture.

Generated/uploaded binary files should not be reformatted or mass-renamed during code refactoring.

29. Do Not Perform Unrequested Cleanup

During a specific task, do not also:

rename unrelated files;

change formatting across the entire repository;

rewrite Indonesian text;

redesign views;

replace libraries;

upgrade dependencies;

rename database fields;

reorganize public assets;

delete "unused" code without verification;

modify seed data;

modify templates;

alter document output.

Keep diffs focused.

30. Security Findings vs Refactoring

If a security issue is discovered while refactoring:

report the issue clearly;

identify the affected code;

explain the risk;

distinguish the security fix from the structural refactor;

do not silently make a large behavior-changing security modification unless the task requires it.

Small, unquestionably safe fixes may be proposed, but preserve scope discipline.

31. Important Current Observations

The current repository has architectural inconsistencies that must be handled carefully:

app.js directly creates a MySQL connection even though a separate database.js exists.

database.js uses a connection pool configured with environment variables.

app.js contains authentication middleware directly.

app.js contains route handlers directly.

app.js contains database queries directly.

app.js contains upload configuration directly.

app.js contains helpers and activity logging directly.

the repository already contains multiple route files.

These are refactoring targets, but not permission to rewrite everything at once.

The first architectural task should be to determine which existing modular files are actually wired into the running application.

32. Database Migration Caution

The standalone database.js currently exposes a promise-based pool.

The large app.js currently uses callback-style MySQL APIs.

Do not simply replace the app.js connection with require('./database') and assume compatibility.

Before consolidation:

inspect the exact exported object;

inspect all db.query call shapes;

decide whether to preserve callback style temporarily or migrate one domain at a time;

verify error/result semantics;

verify connection startup behavior.

Database consolidation is a dedicated refactor step.

33. Refactoring Success Criteria

A refactor is successful when:

application behavior remains the same;

routes remain reachable under the same URLs;

existing frontend calls continue working;

authentication still works;

role flows still work;

database behavior is preserved;

uploads/documents still work;

activity logging remains intact;

code responsibilities are clearer;

app.js becomes smaller;

no duplicate new architecture is created;

changed code can be explained and verified.

Smaller app.js alone is not sufficient if complexity is merely copied into poorly structured files.

34. Desired End State for app.js

The final app.js should eventually resemble a composition root, conceptually similar to:

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/authRoutes');
const staffRoutes = require('./routes/staffRoutes');
const adminRoutes = require('./routes/adminRoutes');
const pimpinanRoutes = require('./routes/pimpinanRoutes');

const app = express();

app.use(helmet(/* preserve required options */));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(authRoutes);
app.use(staffRoutes);
app.use(adminRoutes);
app.use(pimpinanRoutes);

// error handling

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

This example describes the architectural direction only.

Do not copy it blindly.

Actual route prefixes, middleware, imports, and startup behavior must be derived from the current repository.

35. Instructions for Codex When User Says "Refactor the Project"

Do not immediately modify the entire project.

First respond with an audit containing:

current architecture;

all route groups found in app.js;

existing route modules;

duplicated implementations;

database access patterns;

authentication/authorization structure;

upload/document-generation responsibilities;

helper/service-like logic currently inside app.js;

proposed target structure;

incremental migration order;

risks;

files recommended for the first refactor step.

Then wait for the requested implementation scope, unless the user explicitly asks to implement immediately.

If implementation is explicitly requested, still perform the audit internally before editing.

36. Instructions for Codex Before Creating a New File

Before creating any new:

route;

controller;

service;

repository;

middleware;

utility;

search the workspace for an existing equivalent.

If an equivalent exists:

prefer adapting it;

explain why it is or is not usable;

avoid parallel duplicate architecture.

37. Final Rule

Preserve behavior first. Improve structure second. Optimize third.

When uncertain:

inspect more code;

make fewer changes;

preserve the existing contract;

report uncertainty instead of guessing.