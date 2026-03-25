import { Toaster } from "@/components/ui/sonner";
import CreditClear from "./CreditClear";
import { useAuth } from "./auth";

const CSS_LOGIN = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=Manrope:wght@300;400;500;600;700;800&display=swap');
  .login-shell {
    min-height: 100vh;
    background: linear-gradient(175deg, #06090f, #0c1220 50%, #080c16);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Manrope', sans-serif;
    position: relative;
    overflow: hidden;
  }
  .login-shell::before {
    content: '';
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse 70% 40% at 20% -10%, rgba(201,162,39,.06), transparent),
                radial-gradient(ellipse 50% 30% at 85% 110%, rgba(45,212,168,.04), transparent);
    pointer-events: none;
  }
  .login-card {
    background: #131d30;
    border: 1px solid rgba(160,174,192,.07);
    border-radius: 20px;
    padding: 56px 48px;
    text-align: center;
    max-width: 420px;
    width: 90%;
    position: relative;
    z-index: 1;
    box-shadow: 0 24px 80px rgba(0,0,0,.5);
  }
  .login-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 32px;
  }
  .login-logo-m {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #c9a227, #e8c84a);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Playfair Display', serif;
    font-weight: 800;
    font-size: 22px;
    color: #06090f;
    box-shadow: 0 4px 20px rgba(201,162,39,.35);
  }
  .login-logo-t {
    font-family: 'Playfair Display', serif;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -.5px;
    color: #f0f2f8;
  }
  .login-logo-t em { color: #c9a227; font-style: normal; }
  .login-tagline {
    font-size: 14px;
    color: #5a6a85;
    margin-bottom: 40px;
    line-height: 1.6;
  }
  .login-btn {
    width: 100%;
    padding: 14px 24px;
    background: linear-gradient(135deg, #c9a227, #e8c84a);
    color: #06090f;
    border: none;
    border-radius: 10px;
    font-family: 'Manrope', sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: all .2s;
    box-shadow: 0 4px 18px rgba(201,162,39,.3);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .login-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(201,162,39,.4); }
  .login-btn:disabled { opacity: .6; cursor: not-allowed; transform: none; }
  .login-footer {
    margin-top: 24px;
    font-size: 11px;
    color: #5a6a85;
    line-height: 1.5;
  }
  .login-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(6,9,15,.3);
    border-top-color: #06090f;
    border-radius: 50%;
    animation: lspin .7s linear infinite;
  }
  @keyframes lspin { to { transform: rotate(360deg); } }
`;

export default function App() {
  const { isAuthenticated, isLoading, login } = useAuth();

  if (isLoading) {
    return (
      <>
        <style>{CSS_LOGIN}</style>
        <div className="login-shell">
          <div className="login-card">
            <div className="login-logo">
              <div className="login-logo-m">C</div>
              <div className="login-logo-t">
                Credit<em>Clear</em>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "20px 0",
              }}
            >
              <div
                className="login-spinner"
                style={{
                  width: 36,
                  height: 36,
                  borderWidth: 3,
                  borderColor: "rgba(201,162,39,.2)",
                  borderTopColor: "#c9a227",
                }}
              />
            </div>
          </div>
        </div>
        <Toaster />
      </>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <style>{CSS_LOGIN}</style>
        <div className="login-shell" data-ocid="login.page">
          <div className="login-card">
            <div className="login-logo">
              <div className="login-logo-m">C</div>
              <div className="login-logo-t">
                Credit<em>Clear</em>
              </div>
            </div>
            <p className="login-tagline">
              Professional FCRA dispute management.
              <br />
              Secure login required to access your client data.
            </p>
            <button
              type="button"
              className="login-btn"
              onClick={login}
              data-ocid="login.primary_button"
            >
              <span>🔐</span>
              Login with Internet Identity
            </button>
            <p className="login-footer">
              Your data is stored on the Internet Computer blockchain.
              <br />
              Powered by Internet Identity — no passwords required.
            </p>
          </div>
        </div>
        <Toaster />
      </>
    );
  }

  return (
    <>
      <CreditClear />
      <Toaster />
    </>
  );
}
