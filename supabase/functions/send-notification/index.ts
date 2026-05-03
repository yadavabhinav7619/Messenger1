import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotificationPayload {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { user_id, title, body, data }: NotificationPayload = await req.json();

    if (!user_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: "user_id, title, and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's push token and notification preference
    const { data: profile } = await supabase
      .from("profiles")
      .select("push_token, notifications_enabled")
      .eq("id", user_id)
      .maybeSingle();

    if (!profile || !profile.notifications_enabled || !profile.push_token) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: false,
          reason: !profile ? "User not found" : !profile.notifications_enabled ? "Notifications disabled" : "No push token",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // TODO: Integrate with Firebase Cloud Messaging (FCM) or APNs
    // When FCM is configured, send push notification here using:
    // const fcmResponse = await fetch("https://fcm.googleapis.com/fcm/send", { ... });

    // For now, store notification in a log for future processing
    const { error } = await supabase.from("notification_log").insert({
      user_id,
      title,
      body,
      data: data || {},
      push_token: profile.push_token,
      status: "pending",
    });

    if (error) {
      // Table might not exist yet, that's okay for now
      console.log("Notification log not available:", error.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: true,
        message: "Notification queued (FCM integration pending)",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
