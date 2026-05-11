import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404: attempted to access non-existent route:", location.pathname);
    navigate("/", { replace: true });
  }, [location.pathname, navigate]);

  return null;
};

export default NotFound;
