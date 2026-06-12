import styles from "./PrizesPage.module.css";

const PRIZES = [
  { name: "Winner",                              amount: 200, top: true },
  { name: "Runner-up",                           amount: 80,  top: true },
  { name: "Third Place",                         amount: 40,  top: true },
  { name: "Player of the Tournament",            amount: 40  },
  { name: "Goal of the Tournament",              amount: 40  },
  { name: "Worst team to exit group stage",      amount: 20  },
  { name: "Worst team to reach Last 16",         amount: 20  },
  { name: "Worst team to reach Quarter-Finals",  amount: 20  },
];

const TOTAL = PRIZES.reduce((s, p) => s + p.amount, 0);

export default function PrizesPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Prize Money</h1>
      <div className={styles.list}>
        {PRIZES.map((p, i) => (
          <div key={p.name} className={`${styles.row} ${p.top ? styles.top : ""}`}>
            {p.top && <div className={styles.medal}>{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}</div>}
            {!p.top && <div className={styles.icon}>🏆</div>}
            <span className={styles.name}>{p.name}</span>
            <span className={styles.amount}>£{p.amount}</span>
          </div>
        ))}
      </div>
      <div className={styles.total}>
        <span className={styles.totalLabel}>Total prize pot</span>
        <span className={styles.totalAmount}>£{TOTAL}</span>
      </div>
    </div>
  );
}
