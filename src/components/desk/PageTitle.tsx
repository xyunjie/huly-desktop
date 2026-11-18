import type { ReactNode } from "react";

export function PageTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="hd-page-header">
      <h1 className="hd-page-title">{children}</h1>
      {extra}
    </div>
  );
}
