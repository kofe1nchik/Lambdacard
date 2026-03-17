import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import updateLocale from "dayjs/plugin/updateLocale";
import "dayjs/locale/ru";

dayjs.extend(relativeTime);
dayjs.extend(updateLocale);

dayjs.locale("ru");

dayjs.updateLocale("ru", {
  relativeTime: {
    future: "%s",
    past: "%s",
    s: "1м",
    m: "1м",
    mm: "%dм",
    h: "1ч",
    hh: "%dч",
    d: "1д",
    dd: "%dд",
    M: "1мес",
    MM: "%dмес",
    y: "1г",
    yy: "%dг",
  },
});

export function formatInterval(now, due) {
  return dayjs(due).fromNow(true);
}
