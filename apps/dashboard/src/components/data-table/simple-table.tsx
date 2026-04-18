import type { ReactNode } from "react";

export type TableColumn<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

type SimpleTableProps<T> = {
  data: T[];
  columns: TableColumn<T>[];
  emptyMessage?: string;
};

export function SimpleTable<T>({
  data,
  columns,
  emptyMessage = "No records found.",
}: SimpleTableProps<T>) {
  if (!data.length) {
    return <p className="muted-text">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} className={column.className}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.header} className={column.className}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
