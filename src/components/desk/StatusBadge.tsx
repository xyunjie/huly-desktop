import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { statusVisual } from "@/domain/status";
import type { Status } from "@/domain/types";

export function StatusIcon({
  status,
  size = 15,
}: {
  status?: Pick<Status, "name" | "category" | "color"> | null;
  size?: number;
}) {
  const visual = statusVisual(status);
  const stroke = visual.color;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flex: "none", display: "block" }}
    >
      {visual.kind === "backlog" ? (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke={stroke}
          strokeWidth="1.6"
          strokeDasharray="2.2 2.2"
        />
      ) : visual.kind === "todo" ? (
        <circle cx="8" cy="8" r="5.5" stroke={stroke} strokeWidth="1.75" />
      ) : visual.kind === "in-progress" ? (
        <>
          <circle cx="8" cy="8" r="5.5" stroke={stroke} strokeWidth="1.6" />
          <path d="M8 4 A4 4 0 0 1 8 12 Z" fill={stroke} />
        </>
      ) : visual.kind === "review" ? (
        <>
          <circle cx="8" cy="8" r="5.75" stroke={stroke} strokeWidth="1.6" />
          <circle cx="8" cy="8" r="2.5" fill={stroke} />
        </>
      ) : visual.kind === "done" ? (
        <>
          <circle cx="8" cy="8" r="6.25" fill={stroke} />
          <path
            d="M5.2 8.2L7.1 10.1L11 6.1"
            stroke="#fff"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="5.5" stroke={stroke} strokeWidth="1.6" />
          <path d="M5.2 10.8L10.8 5.2" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function StatusPill({
  status,
  fallbackName = "未知状态",
  interactive = false,
}: {
  status?: Status | null;
  fallbackName?: string;
  interactive?: boolean;
}) {
  const visual = statusVisual(status);
  return (
    <span
      className={interactive ? "hd-status-pill hd-status-pill-interactive" : "hd-status-pill"}
      style={{
        background: visual.bg,
        borderColor: visual.border,
        color: visual.textColor,
      }}
    >
      <StatusIcon status={status} size={13} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {status?.name ?? fallbackName}
      </span>
    </span>
  );
}

export function StatusQuickSelect({
  status,
  statuses,
  onChange,
}: {
  status?: Status | null;
  statuses: Status[];
  onChange?: (statusId: string) => void;
}) {
  if (!onChange || statuses.length === 0) {
    return <StatusPill status={status} />;
  }

  const items: MenuProps["items"] = statuses.map((item) => ({
    key: item.id,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 96 }}>
        <StatusIcon status={item} size={14} />
        <span style={{ fontWeight: item.id === status?.id ? 600 : 400 }}>{item.name}</span>
      </span>
    ),
  }));

  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items,
        selectedKeys: status ? [status.id] : [],
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          if (key !== status?.id) onChange(key);
        },
      }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={`切换状态：${status?.name ?? "未知状态"}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
          }
        }}
        style={{ display: "inline-flex", maxWidth: "100%" }}
      >
        <StatusPill status={status} interactive />
      </span>
    </Dropdown>
  );
}
