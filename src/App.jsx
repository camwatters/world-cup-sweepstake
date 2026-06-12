import { HashRouter, Routes, Route } from "react-router-dom";
import Nav from "./components/Nav";
import DrawPage from "./pages/DrawPage";
import GroupsPage from "./pages/GroupsPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <HashRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<DrawPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </HashRouter>
  );
}
