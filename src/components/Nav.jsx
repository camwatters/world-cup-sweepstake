import { NavLink } from "react-router-dom";
import styles from "./Nav.module.css";

export default function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>⚽ WC2026 Sweepstake</div>
      <div className={styles.links}>
        <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ""}>
          Draw
        </NavLink>
        <NavLink to="/groups" className={({ isActive }) => isActive ? styles.active : ""}>
          Groups & Fixtures
        </NavLink>
      </div>
    </nav>
  );
}
