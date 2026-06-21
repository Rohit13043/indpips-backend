//+------------------------------------------------------------------+
//|                                            INDPIPS_Bridge.mq5     |
//|   Pushes MT5 account state, open positions and closed deals to    |
//|   the INDPIPS backend /ingest endpoint (EA-bridge integration).   |
//|                                                                   |
//|   SETUP (one time):                                               |
//|   1. In MetaTrader 5: Tools > Options > Expert Advisors           |
//|        - tick "Allow WebRequest for listed URL"                   |
//|        - add your API origin, e.g.  https://api.indpips.com       |
//|   2. Attach this EA to any one chart. It runs on a timer.         |
//|   3. Set the inputs below (ApiUrl + Secret must match the server).|
//+------------------------------------------------------------------+
#property copyright "INDPIPS"
#property version   "1.00"
#property strict

input string ApiUrl          = "https://api.indpips.com/ingest"; // full URL of the /ingest endpoint
input string Secret          = "change-me";                       // must equal EA_BRIDGE_SECRET on the server
input int    SendIntervalSec = 30;                                // how often to push (seconds)
input int    HistoryDays     = 7;                                 // how far back to send closed deals

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(ApiUrl) < 8 || StringFind(ApiUrl, "http") != 0)
     {
      Print("INDPIPS: invalid ApiUrl");
      return(INIT_FAILED);
     }
   EventSetTimer(MathMax(5, SendIntervalSec));
   Print("INDPIPS bridge started. Pushing to ", ApiUrl, " every ", SendIntervalSec, "s");
   SendSnapshot();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { SendSnapshot(); }

//+------------------------------------------------------------------+
//| Minimal JSON string escaper                                       |
//+------------------------------------------------------------------+
string JsonEsc(string s)
  {
   string o = "";
   for(int i = 0; i < StringLen(s); i++)
     {
      ushort c = StringGetCharacter(s, i);
      if(c == '"')      o += "\\\"";
      else if(c == '\\') o += "\\\\";
      else if(c == '\n') o += "\\n";
      else if(c == '\r') o += "\\r";
      else if(c == '\t') o += "\\t";
      else               o += ShortToString(c);
     }
   return(o);
  }

//+------------------------------------------------------------------+
//| Format an MT5 server datetime as ISO 8601 (with Z suffix)         |
//| NOTE: this is broker server time; the backend daily boundary      |
//| (02:30 IST = 21:00 UTC) assumes server time. Adjust if needed.    |
//+------------------------------------------------------------------+
string IsoTime(datetime t)
  {
   MqlDateTime d;
   TimeToStruct(t, d);
   return(StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
          d.year, d.mon, d.day, d.hour, d.min, d.sec));
  }

string DealSide(long dealType)
  {
   if(dealType == DEAL_TYPE_BUY)  return("buy");
   if(dealType == DEAL_TYPE_SELL) return("sell");
   return("buy");
  }

//+------------------------------------------------------------------+
//| Build and POST the snapshot                                       |
//+------------------------------------------------------------------+
void SendSnapshot()
  {
   long   login    = AccountInfoInteger(ACCOUNT_LOGIN);
   string server   = AccountInfoString(ACCOUNT_SERVER);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);

   // ---- open positions ----
   string positions = "";
   int posTotal = PositionsTotal();
   for(int i = 0; i < posTotal; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      string sym   = PositionGetString(POSITION_SYMBOL);
      long   ptype = PositionGetInteger(POSITION_TYPE);
      double vol   = PositionGetDouble(POSITION_VOLUME);
      double openP = PositionGetDouble(POSITION_PRICE_OPEN);
      double curP  = PositionGetDouble(POSITION_PRICE_CURRENT);
      double fpnl  = PositionGetDouble(POSITION_PROFIT);
      datetime ot  = (datetime)PositionGetInteger(POSITION_TIME);
      if(positions != "") positions += ",";
      positions += StringFormat(
        "{\"externalId\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.2f,\"openPrice\":%.5f,\"currentPrice\":%.5f,\"floatingPnl\":%.2f,\"openedAt\":\"%s\"}",
        ticket, JsonEsc(sym), (ptype==POSITION_TYPE_SELL?"sell":"buy"), vol, openP, curP, fpnl, IsoTime(ot));
     }

   // ---- closed deals (last HistoryDays) ----
   // First pass: map position_id -> open time/price from DEAL_ENTRY_IN deals.
   datetime from = TimeCurrent() - (datetime)HistoryDays * 86400;
   HistorySelect(from, TimeCurrent());
   int total = HistoryDealsTotal();

   string deals = "";
   for(int i = 0; i < total; i++)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT) continue;          // only realised, position-closing deals
      long dtype = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL) continue;

      string sym  = HistoryDealGetString(ticket, DEAL_SYMBOL);
      double vol  = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double price= HistoryDealGetDouble(ticket, DEAL_PRICE);
      double prof = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double comm = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double swap = HistoryDealGetDouble(ticket, DEAL_SWAP);
      datetime ct = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      long posId  = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);

      // find matching open (IN) deal for openedAt / openPrice
      datetime ot = ct; double openP = price;
      for(int j = 0; j < total; j++)
        {
         ulong t2 = HistoryDealGetTicket(j);
         if(t2 == 0) continue;
         if(HistoryDealGetInteger(t2, DEAL_POSITION_ID) == posId &&
            HistoryDealGetInteger(t2, DEAL_ENTRY) == DEAL_ENTRY_IN)
           {
            ot    = (datetime)HistoryDealGetInteger(t2, DEAL_TIME);
            openP = HistoryDealGetDouble(t2, DEAL_PRICE);
            break;
           }
        }

      if(deals != "") deals += ",";
      deals += StringFormat(
        "{\"externalId\":\"%I64u\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.2f,\"openPrice\":%.5f,\"closePrice\":%.5f,\"profit\":%.2f,\"commission\":%.2f,\"swap\":%.2f,\"openedAt\":\"%s\",\"closedAt\":\"%s\"}",
        ticket, JsonEsc(sym), DealSide(dtype), vol, openP, price, prof, comm, swap, IsoTime(ot), IsoTime(ct));
     }

   string body = StringFormat(
     "{\"login\":\"%I64d\",\"server\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"currency\":\"%s\",\"deals\":[%s],\"positions\":[%s]}",
     login, JsonEsc(server), balance, equity, JsonEsc(currency), deals, positions);

   PostJson(body);
  }

//+------------------------------------------------------------------+
//| HTTP POST via WebRequest                                          |
//+------------------------------------------------------------------+
void PostJson(string body)
  {
   char post[]; char result[]; string resultHeaders;
   StringToCharArray(body, post, 0, StringLen(body), CP_UTF8);
   // StringToCharArray appends a trailing 0; trim it so Content-Length is correct
   int len = ArraySize(post);
   if(len > 0 && post[len-1] == 0) ArrayResize(post, len-1);

   string headers = "Content-Type: application/json\r\nx-ea-secret: " + Secret + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", ApiUrl, headers, 5000, post, result, resultHeaders);
   if(code == -1)
     {
      int err = GetLastError();
      Print("INDPIPS WebRequest failed (", err, "). Did you whitelist the URL in Tools>Options>Expert Advisors?");
      return;
     }
   if(code < 200 || code >= 300)
      Print("INDPIPS ingest HTTP ", code, ": ", CharArrayToString(result));
  }
//+------------------------------------------------------------------+
