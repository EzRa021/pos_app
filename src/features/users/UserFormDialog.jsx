// features/users/UserFormDialog.jsx — Create / Edit user
import { useState, useEffect } from "react";
import { Loader2, User, Mail, Phone, Lock, Shield, Store, Eye, EyeOff } from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getRoleConfig } from "./roleConfig";

const EMPTY = {
  username:   "",
  email:      "",
  password:   "",
  first_name: "",
  last_name:  "",
  phone:      "",
  role_id:    "",
  store_id:   "",
};

export function UserFormDialog({ open, onOpenChange, user, roles = [], stores = [], onSubmit, isLoading }) {
  const isEdit = !!user;
  const [form, setForm]         = useState(EMPTY);
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors]     = useState({});

  // Populate form when editing
  useEffect(() => {
    if (open) {
      if (user) {
        setForm({
          username:   user.username   ?? "",
          email:      user.email      ?? "",
          password:   "",
          first_name: user.first_name ?? "",
          last_name:  user.last_name  ?? "",
          phone:      user.phone      ?? "",
          role_id:    String(user.role_id ?? ""),
          store_id:   user.store_id ? String(user.store_id) : "",
        });
      } else {
        setForm(EMPTY);
      }
      setErrors({});
      setShowPass(false);
    }
  }, [open, user]);

  const set = (field, value) => {
    setForm((p) => ({ ...p, [field]: value }));
    setErrors((p) => ({ ...p, [field]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!form.first_name.trim()) e.first_name = "Required";
    if (!form.last_name.trim())  e.last_name  = "Required";
    if (!form.username.trim())   e.username   = "Required";
    if (!form.email.trim())      e.email      = "Required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Invalid email";
    if (!isEdit && !form.password) e.password = "Required";
    if (form.password && form.password.length < 8) e.password = "Min 8 characters";
    if (!form.role_id) e.role_id = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const payload = {
      username:   form.username.trim(),
      email:      form.email.trim(),
      first_name: form.first_name.trim(),
      last_name:  form.last_name.trim(),
      phone:      form.phone.trim() || null,
      role_id:    parseInt(form.role_id),
      store_id:   form.store_id ? parseInt(form.store_id) : null,
    };
    if (!isEdit || form.password) payload.password = form.password;
    onSubmit(payload);
  };

  const selectedRole = roles.find((r) => String(r.id) === form.role_id);
  const roleConfig   = selectedRole ? getRoleConfig(selectedRole.role_slug) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border/80 shadow-2xl shadow-black/60 p-0 overflow-hidden">
        {/* Top colour stripe */}
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/60 to-transparent" />

        <div className="px-6 pt-5 pb-6 space-y-5">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold text-foreground">
              {isEdit ? "Edit User" : "Create New User"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isEdit
                ? "Update account details. Leave password blank to keep existing."
                : "Fill in all required fields to create a new account."}
            </DialogDescription>
          </DialogHeader>

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" icon={User} error={errors.first_name} required>
              <Input
                placeholder="John"
                value={form.first_name}
                onChange={(e) => set("first_name", e.target.value)}
                className={inputCls(errors.first_name)}
              />
            </Field>
            <Field label="Last Name" error={errors.last_name} required>
              <Input
                placeholder="Doe"
                value={form.last_name}
                onChange={(e) => set("last_name", e.target.value)}
                className={inputCls(errors.last_name)}
              />
            </Field>
          </div>

          {/* Username + email */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username" icon={User} error={errors.username} required>
              <Input
                placeholder="johndoe"
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                disabled={isEdit}
                className={inputCls(errors.username)}
              />
            </Field>
            <Field label="Email" icon={Mail} error={errors.email} required>
              <Input
                type="email"
                placeholder="john@store.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                className={inputCls(errors.email)}
              />
            </Field>
          </div>

          {/* Phone + password */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" icon={Phone}>
              <Input
                placeholder="+234 800 000 0000"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className={inputCls()}
              />
            </Field>
            <Field
              label={isEdit ? "New Password (optional)" : "Password"}
              icon={Lock}
              error={errors.password}
              required={!isEdit}
            >
              <div className="relative">
                <Input
                  type={showPass ? "text" : "password"}
                  placeholder={isEdit ? "Leave blank to keep" : "Min 8 characters"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  className={cn(inputCls(errors.password), "pr-8")}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((p) => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </Field>
          </div>

          {/* Role + Store */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role" icon={Shield} error={errors.role_id} required>
              <Select value={form.role_id} onValueChange={(v) => set("role_id", v)}>
                <SelectTrigger className={cn("h-9 text-[12px]", errors.role_id && "border-destructive")}>
                  {roleConfig ? (
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", roleConfig.dot)} />
                      {selectedRole?.role_name}
                    </span>
                  ) : (
                    <SelectValue placeholder="Select role" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => {
                    const rc = getRoleConfig(r.role_slug);
                    return (
                      <SelectItem key={r.id} value={String(r.id)}>
                        <span className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full shrink-0", rc.dot)} />
                          {r.role_name}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Store" icon={Store}>
              <Select
                value={form.store_id || "none"}
                onValueChange={(v) => set("store_id", v === "none" ? "" : v)}
              >
                <SelectTrigger className="h-9 text-[12px]">
                  <SelectValue placeholder="All stores (global)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground italic">All stores (global)</span>
                  </SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.store_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Role description tip */}
          {selectedRole?.description && (
            <p className="text-[11px] text-muted-foreground rounded-lg bg-muted/30 border border-border/40 px-3 py-2 leading-relaxed">
              <span className="font-semibold text-foreground/70">Role note: </span>
              {selectedRole.description}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline" className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button className="flex-1 gap-1.5" onClick={handleSubmit} disabled={isLoading}>
              {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Create User"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, icon: Icon, error, required, children }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

function inputCls(error) {
  return cn("h-9 text-[12px] bg-background/50", error && "border-destructive");
}
