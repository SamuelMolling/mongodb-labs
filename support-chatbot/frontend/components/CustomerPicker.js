"use client";

/**
 * Switches the acting customer.
 *
 * In a real product this control does not exist — the customer comes from the
 * session. It is here because swapping plans is how you exercise the
 * entitlement pre-filter by hand: ask the same question as the Free customer
 * and as the Enterprise one, and watch the passage list change in the
 * inspector rather than taking the filter's word for it.
 */
export function CustomerPicker({ customers, value, onChange, disabled }) {
  return (
    <label className="row small" style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
      <span className="muted">acting as</span>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        style={{ width: "auto", minWidth: 240 }}
      >
        <option value="">anonymous (no account data)</option>
        {customers.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name} — {c.plan}
          </option>
        ))}
      </select>
    </label>
  );
}
