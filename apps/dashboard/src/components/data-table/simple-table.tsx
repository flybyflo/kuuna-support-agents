import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils/cn";

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
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.header}
              className={cn("bg-muted/40", column.className)}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, index) => (
          <TableRow key={index}>
            {columns.map((column) => (
              <TableCell key={column.header} className={column.className}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
