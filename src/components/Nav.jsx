import { NavLink } from "react-router-dom";
import styles from "./Nav.module.css";
import T from "../tournament";

export default function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>⚽ {T.brand}</div>
      <div className={styles.links}>
        <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ""}>
          Draw
        </NavLink>
        <NavLink to="/groups" className={({ isActive }) => isActive ? styles.active : ""}>
          Groups & Fixtures
        </NavLink>
        <NavLink to="/prizes" className={({ isActive }) => isActive ? styles.active : ""}>
          Prizes
        </NavLink>
      </div>
    </nav>
  );
}
