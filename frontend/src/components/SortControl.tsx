import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { t } from "../i18n";
import { Menu, MenuGroup, MenuItem, PopupSelect, useMediaQuery }
  from "./ui";

/** Sort field + direction. From 768 px: a pop-up button ("Sort: Mails ↓")
 *  whose menu
 *  holds the keys and Descending / Ascending (the column header keeps its
 *  one-click toggle). On a phone: one icon button opening a Menu with
 *  the sort keys (active one marked) and Ascending / Descending, so the
 *  filter box keeps the row. Shared by the group list and All mails. */
export function SortControl<K extends string>({ options, value, dir,
  onValue, onDir, plain = false, orderHints }: {
  options: { k: K; label: string }[];
  value: K;
  dir: "asc" | "desc";
  onValue: (k: K) => void;
  onDir: (d: "asc" | "desc") => void;
  /** Phone trigger as a plain accent icon (the Senders toolbar). */
  plain?: boolean;
  /** A few words next to Descending / Ascending while the current key needs
   *  them ("worst first" for the grade sort). */
  orderHints?: { desc?: string; asc?: string };
}) {
  const phone = useMediaQuery("(width < 48rem)");
  // The labels read "Sort: mails"; under the "Sort by" caption the key alone is enough.
  const short = (l: string) => {
    const x = t(l).replace(/^[^:]*:\s*/, "");
    return x.charAt(0).toUpperCase() + x.slice(1);
  };
  // The order label, with the hint of the current key after it.
  const order = (d: "asc" | "desc") => {
    const label = t(d === "asc" ? "sort.ascending" : "sort.descending");
    const hint = orderHints?.[d];
    return hint ? (
      <span className="flex min-w-0 items-baseline gap-2">{label}
        <span className="type-meta text-muted">{hint}</span></span>
    ) : label;
  };
  if (phone) {
    return (
      <Menu variant={plain ? "plain" : "secondary"} icon
        triggerClass={plain ? "coarse:size-11" : undefined}
        label={t("sort.menu_state", {
          key: t(options.find((o) => o.k === value)?.label ?? ""),
          dir: t(dir === "asc" ? "sort.ascending" : "sort.descending")
            .toLowerCase() })}
        trigger={<ArrowUpDown size={18} />}>
        <MenuGroup label={t("sort.by")}>
          {options.map((o) => (
            <MenuItem key={o.k} active={o.k === value}
              onClick={() => onValue(o.k)}>
              {short(o.label)}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuGroup label={t("sort.order")}>
          <MenuItem active={dir === "desc"} onClick={() => onDir("desc")}>
            {order("desc")}
          </MenuItem>
          <MenuItem active={dir === "asc"} onClick={() => onDir("asc")}>
            {order("asc")}
          </MenuItem>
        </MenuGroup>
      </Menu>
    );
  }
  return (
    <PopupSelect<string> className="shrink-0"
      label={`${t("sort.menu")}:`}
      valueLabel={`${short(options.find((o) => o.k === value)?.label ?? "")} ${
        dir === "desc" ? "↓" : "↑"}`}
      options={[
        { heading: t("sort.by") },
        ...options.map((o) => ({ value: `k:${o.k}`, label: short(o.label),
          checked: o.k === value })),
        { heading: t("sort.order") },
        { value: "d:desc", label: order("desc"),
          icon: <ArrowDown size={14} aria-hidden />, checked: dir === "desc" },
        { value: "d:asc", label: order("asc"),
          icon: <ArrowUp size={14} aria-hidden />, checked: dir === "asc" },
      ]}
      onChange={(v) => {
        if (v === "d:desc") onDir("desc");
        else if (v === "d:asc") onDir("asc");
        else onValue(v.slice(2) as K);
      }} />
  );
}
