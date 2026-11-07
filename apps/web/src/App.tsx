import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./components/RequireAuth";
import { ShellLayout } from "./components/ShellLayout";
import { LoginPage } from "./features/auth/LoginPage";
import { LibraryPage } from "./features/library/LibraryPage";
import { ReaderPage } from "./features/reader/ReaderPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<LibraryPage />} />
        </Route>
        <Route path="/read/:bookId" element={<ReaderPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
