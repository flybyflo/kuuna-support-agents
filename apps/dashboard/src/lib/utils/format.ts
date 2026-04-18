const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = MONTHS_SHORT[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();

  const hour24 = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  const minutePadded = String(minute).padStart(2, "0");

  return `${month} ${day}, ${year}, ${hour12}:${minutePadded} ${ampm} UTC`;
}

export function titleFromGroupId(groupId: string): string {
  if (groupId.includes("@")) {
    const [user, server] = groupId.split("@", 2);
    if (server === "g.us") {
      return `WhatsApp Group ${user}`;
    }
    if (server === "lid") {
      return `WhatsApp Chat ${user}`;
    }
    if (server === "s.whatsapp.net") {
      return `WhatsApp Contact ${user}`;
    }
    return `WhatsApp ${groupId}`;
  }

  return groupId
    .replace(/^grp-/, "")
    .split("-")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}
