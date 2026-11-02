 Hi team,

  To prepare the Freshdesk integration for the STP system, I need the following:

  1. Permission to call read-only (GET) APIs on the production Freshdesk account,
     to study the ticket fields and the shape of a few real claim tickets.
     No create or update calls will be made on production.
  2. The Freshdesk plan that ULINK uses (Growth, Pro, or Enterprise),
     because the API rate limit depends on the plan.
  3. Which support mailbox(es) receive claim submissions, and which Freshdesk
     group(s) handle claims, so the system reads only claim tickets.
  4. The ticket fields that the system must update (status, group, type, tags,
     custom fields), and the value to set at each step of the claim flow.
  5. Whether a dedicated agent seat ("STP bot") can be created for the system.
     The API key belongs to one agent, and every reply shows that agent's name.
  6. How the system must send internal notices to ops: as a private note on the
     ticket, or as a forward to an ops email address.

  Thank you.