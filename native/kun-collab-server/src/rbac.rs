pub fn can_submit(role: &str, status: &str) -> bool {
    status == "active" && matches!(role, "owner" | "admin" | "member" | "reviewer")
}

pub fn can_manage_members(role: &str, status: &str) -> bool {
    status == "active" && matches!(role, "owner" | "admin")
}
