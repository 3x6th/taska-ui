import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import type { AdminService } from "../../domain/types";

/**
 * The catalog column of the Data section (DESIGN.md §5.8): a search field over
 * a list of tables grouped by service.
 *
 * It replaces the flat row of chips that stood here until TAS-159. That row
 * held the mock's four tables and broke at about ten; six service databases
 * give three or four dozen, which is a list with a search over it, not a row.
 */
export function AdminCatalogColumn({ services }: { services: AdminService[] }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (
      services
        .map((service) => ({
          ...service,
          // A service whose *name* matches keeps all of its tables: someone
          // typing "auth" is asking for that database, not for a table called
          // auth.
          tables:
            !needle || service.name.toLowerCase().includes(needle)
              ? (service.tables ?? [])
              : (service.tables ?? []).filter((table) => table.name.toLowerCase().includes(needle)),
        }))
        // A service with nothing to open is a heading over a void, whether it
        // was emptied by the search or arrived that way.
        .filter((service) => service.tables.length > 0)
    );
  }, [query, services]);

  return (
    <div className="admin-catalog">
      <div className="search-box admin-catalog-search">
        <Search aria-hidden="true" size={14} />
        <input
          aria-label="Search tables"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tables"
          type="search"
          value={query}
        />
      </div>

      <nav aria-label="Tables" className="admin-catalog-list">
        {matches.map((service) => (
          <div key={service.name}>
            <h2 className="admin-catalog-group">{service.name}</h2>
            <ul>
              {service.tables.map((table) => (
                <li key={table.name}>
                  {/* A link, not a button: the table is an address now (§5.8),
                      so it has to be copyable and middle-clickable. No query
                      string on purpose — page, sort and filter belonged to the
                      table being left. */}
                  <NavLink className="admin-catalog-item" to={`/admin/data/${service.name}/${table.name}`}>
                    {table.name}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {matches.length === 0 ? <p className="admin-catalog-empty">Nothing matches</p> : null}
      </nav>
    </div>
  );
}
