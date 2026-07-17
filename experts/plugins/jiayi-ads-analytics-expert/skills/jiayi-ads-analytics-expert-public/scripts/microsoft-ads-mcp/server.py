#!/usr/bin/env python3
"""
Microsoft Advertising MCP Server
Full-featured campaign management and reporting via Bing Ads API
Based on features from insightfulpipe/microsoft-ads-mcp-server
"""

import json
import os
import logging
from pathlib import Path
from datetime import datetime, timedelta

from fastmcp import FastMCP

from bingads.service_client import ServiceClient
from bingads.authorization import AuthorizationData, OAuthDesktopMobileAuthCodeGrant

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("microsoft-ads-server")

DEVELOPER_TOKEN = os.environ.get("MICROSOFT_ADS_DEVELOPER_TOKEN", "")
CLIENT_ID = os.environ.get("MICROSOFT_ADS_CLIENT_ID", "")
REFRESH_TOKEN = os.environ.get("MICROSOFT_ADS_REFRESH_TOKEN", "")
CUSTOMER_ID = os.environ.get("MICROSOFT_ADS_CUSTOMER_ID", "")
ACCOUNT_ID = os.environ.get("MICROSOFT_ADS_ACCOUNT_ID", "")

TOKEN_PATH = Path(__file__).parent / "config" / "tokens.json"

mcp = FastMCP("microsoft-ads")

def load_tokens():
    if TOKEN_PATH.exists():
        with open(TOKEN_PATH) as f:
            return json.load(f)
    return {}

def save_tokens(tokens):
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_PATH, "w") as f:
        json.dump(tokens, f, indent=2)

def get_authorization():
    tokens = load_tokens()
    refresh_token = REFRESH_TOKEN or tokens.get("refresh_token")

    if not CLIENT_ID:
        raise ValueError("MICROSOFT_ADS_CLIENT_ID not set")
    if not DEVELOPER_TOKEN:
        raise ValueError("MICROSOFT_ADS_DEVELOPER_TOKEN not set")

    auth = AuthorizationData(
        account_id=ACCOUNT_ID or tokens.get("account_id"),
        customer_id=CUSTOMER_ID or tokens.get("customer_id"),
        developer_token=DEVELOPER_TOKEN,
        authentication=OAuthDesktopMobileAuthCodeGrant(client_id=CLIENT_ID, env="production")
    )

    if refresh_token:
        auth.authentication.request_oauth_tokens_by_refresh_token(refresh_token)
        save_tokens({**tokens, "refresh_token": auth.authentication.oauth_tokens.refresh_token})

    return auth

# ============= AUTHENTICATION =============

@mcp.tool()
def get_auth_url() -> str:
    """Get OAuth URL. Open in browser, sign in, then use complete_auth with the redirect URL."""
    if not CLIENT_ID:
        return "Error: MICROSOFT_ADS_CLIENT_ID not set"
    oauth = OAuthDesktopMobileAuthCodeGrant(client_id=CLIENT_ID, env="production")
    return f"Open this URL:\n\n{oauth.get_authorization_endpoint()}\n\nThen use complete_auth with the redirect URL."

@mcp.tool()
def complete_auth(redirect_url: str) -> str:
    """Complete OAuth with the redirect URL from browser."""
    try:
        oauth = OAuthDesktopMobileAuthCodeGrant(client_id=CLIENT_ID, env="production")
        oauth.request_oauth_tokens_by_response_uri(redirect_url)
        save_tokens({"refresh_token": oauth.oauth_tokens.refresh_token})
        return "Authentication successful!"
    except Exception as e:
        return f"Error: {str(e)}"

# ============= ACCOUNT MANAGEMENT =============

@mcp.tool()
def search_accounts() -> str:
    """List all Microsoft Advertising accounts accessible to the authenticated user."""
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CustomerManagementService', version=13, authorization_data=auth)

        user_resp = svc.GetUser(UserId=None)
        user = user_resp.User

        result = f"User: {user.UserName} (ID: {user.Id})\n\nAccounts:\n"

        if user_resp.CustomerRoles and user_resp.CustomerRoles.CustomerRole:
            for role in user_resp.CustomerRoles.CustomerRole:
                accounts = svc.GetAccountsInfo(CustomerId=role.CustomerId)
                if accounts and accounts.AccountInfo:
                    for acc in accounts.AccountInfo:
                        result += f"- {acc.Name}\n  Account ID: {acc.Id}\n  Customer ID: {role.CustomerId}\n  Status: {acc.AccountLifeCycleStatus}\n\n"

        return result if "Account ID:" in result else result + "No accounts found.\n"
    except Exception as e:
        return f"Error: {str(e)}"

# ============= CAMPAIGNS =============

@mcp.tool()
def get_campaigns(include_deleted: bool = False) -> str:
    """
    Get all campaigns in the account.

    Args:
        include_deleted: Include deleted campaigns (default: False)
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        resp = svc.GetCampaignsByAccountId(
            AccountId=auth.account_id,
            CampaignType='Search DynamicSearchAds Shopping Audience PerformanceMax'
        )

        campaigns = resp.Campaign if resp and hasattr(resp, 'Campaign') and resp.Campaign else []
        if not campaigns:
            return "No campaigns found."

        result = "Campaigns:\n\n"
        for c in campaigns:
            if not include_deleted and c.Status == 'Deleted':
                continue
            budget = f"${c.DailyBudget:.2f}/day" if c.DailyBudget else "N/A"
            result += f"**{c.Name}**\n"
            result += f"  ID: {c.Id}\n"
            result += f"  Status: {c.Status}\n"
            result += f"  Budget: {budget}\n"
            result += f"  Type: {c.CampaignType}\n\n"
        return result
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def create_campaign(name: str, daily_budget: float, description: str = "") -> str:
    """
    Create a new search campaign (paused by default for safety).

    Args:
        name: Campaign name
        daily_budget: Daily budget in dollars
        description: Optional description
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        campaign = svc.factory.create('Campaign')
        campaign.Name = name
        campaign.Description = description or name
        campaign.BudgetType = 'DailyBudgetStandard'
        campaign.DailyBudget = daily_budget
        campaign.Status = 'Paused'
        campaign.TimeZone = 'EasternTimeUSCanada'

        campaigns = svc.factory.create('ArrayOfCampaign')
        campaigns.Campaign.append(campaign)

        resp = svc.AddCampaigns(AccountId=auth.account_id, Campaigns=campaigns)

        if resp.CampaignIds and resp.CampaignIds.long:
            return f"Campaign created (PAUSED):\n- Name: {name}\n- ID: {resp.CampaignIds.long[0]}\n- Budget: ${daily_budget}/day"
        return f"Failed: {resp.PartialErrors}"
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def update_campaign_status(campaign_id: int, status: str) -> str:
    """
    Update campaign status.

    Args:
        campaign_id: Campaign ID
        status: Active or Paused
    """
    if status not in ['Active', 'Paused']:
        return "Error: status must be 'Active' or 'Paused'"
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        resp = svc.GetCampaignsByIds(AccountId=auth.account_id, CampaignIds={'long': [campaign_id]}, CampaignType='Search')
        if not resp.Campaigns or not resp.Campaigns.Campaign:
            return f"Campaign {campaign_id} not found."

        campaign = resp.Campaigns.Campaign[0]
        campaign.Status = status

        campaigns = svc.factory.create('ArrayOfCampaign')
        campaigns.Campaign.append(campaign)
        svc.UpdateCampaigns(AccountId=auth.account_id, Campaigns=campaigns)

        return f"Campaign {campaign_id} status updated to {status}."
    except Exception as e:
        return f"Error: {str(e)}"

# ============= AD GROUPS =============

@mcp.tool()
def get_ad_groups(campaign_id: int) -> str:
    """
    Get all ad groups in a campaign.

    Args:
        campaign_id: Campaign ID to get ad groups for
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        resp = svc.GetAdGroupsByCampaignId(CampaignId=campaign_id)

        if not resp or not hasattr(resp, 'AdGroups') or not resp.AdGroups or not resp.AdGroups.AdGroup:
            return f"No ad groups found for campaign {campaign_id}."

        result = f"Ad Groups for Campaign {campaign_id}:\n\n"
        for ag in resp.AdGroups.AdGroup:
            cpc = f"${ag.CpcBid.Amount:.2f}" if ag.CpcBid and ag.CpcBid.Amount else "Auto"
            result += f"**{ag.Name}**\n"
            result += f"  ID: {ag.Id}\n"
            result += f"  Status: {ag.Status}\n"
            result += f"  CPC Bid: {cpc}\n\n"
        return result
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def create_ad_group(campaign_id: int, name: str, cpc_bid: float = 1.0) -> str:
    """
    Create an ad group in a campaign.

    Args:
        campaign_id: Campaign ID
        name: Ad group name
        cpc_bid: Default CPC bid in dollars (default: $1.00)
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        ad_group = svc.factory.create('AdGroup')
        ad_group.Name = name
        ad_group.Status = 'Paused'

        cpc = svc.factory.create('Bid')
        cpc.Amount = cpc_bid
        ad_group.CpcBid = cpc

        ad_groups = svc.factory.create('ArrayOfAdGroup')
        ad_groups.AdGroup.append(ad_group)

        resp = svc.AddAdGroups(CampaignId=campaign_id, AdGroups=ad_groups, ReturnInheritedBidStrategyTypes=False)

        if resp.AdGroupIds and resp.AdGroupIds.long:
            return f"Ad Group created:\n- Name: {name}\n- ID: {resp.AdGroupIds.long[0]}\n- CPC: ${cpc_bid}"
        return f"Failed: {resp.PartialErrors}"
    except Exception as e:
        return f"Error: {str(e)}"

# ============= KEYWORDS =============

@mcp.tool()
def get_keywords(ad_group_id: int) -> str:
    """
    Get all keywords in an ad group.

    Args:
        ad_group_id: Ad Group ID
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        resp = svc.GetKeywordsByAdGroupId(AdGroupId=ad_group_id)

        if not resp or not hasattr(resp, 'Keywords') or not resp.Keywords or not resp.Keywords.Keyword:
            return f"No keywords found for ad group {ad_group_id}."

        result = f"Keywords for Ad Group {ad_group_id}:\n\n"
        for kw in resp.Keywords.Keyword:
            bid = f"${kw.Bid.Amount:.2f}" if kw.Bid and kw.Bid.Amount else "Auto"
            result += f"- {kw.Text}\n"
            result += f"  ID: {kw.Id} | Match: {kw.MatchType} | Status: {kw.Status} | Bid: {bid}\n"
        return result
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def add_keywords(ad_group_id: int, keywords: str, match_type: str = "Broad", default_bid: float = 1.0) -> str:
    """
    Add keywords to an ad group.

    Args:
        ad_group_id: Ad Group ID
        keywords: Comma-separated keywords
        match_type: Broad, Phrase, or Exact (default: Broad)
        default_bid: Default CPC bid in dollars (default: $1.00)
    """
    if match_type not in ['Broad', 'Phrase', 'Exact']:
        return "Error: match_type must be Broad, Phrase, or Exact"

    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        keyword_list = [k.strip() for k in keywords.split(",")]
        kw_array = svc.factory.create('ArrayOfKeyword')

        for kw_text in keyword_list:
            kw = svc.factory.create('Keyword')
            kw.Text = kw_text
            kw.MatchType = match_type
            kw.Status = 'Active'
            bid = svc.factory.create('Bid')
            bid.Amount = default_bid
            kw.Bid = bid
            kw_array.Keyword.append(kw)

        resp = svc.AddKeywords(AdGroupId=ad_group_id, Keywords=kw_array)

        added = len(resp.KeywordIds.long) if resp.KeywordIds and resp.KeywordIds.long else 0
        return f"Added {added} keywords to ad group {ad_group_id}:\n{', '.join(keyword_list)}"
    except Exception as e:
        return f"Error: {str(e)}"

# ============= ADS =============

@mcp.tool()
def get_ads(ad_group_id: int) -> str:
    """
    Get all ads in an ad group.

    Args:
        ad_group_id: Ad Group ID
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        resp = svc.GetAdsByAdGroupId(AdGroupId=ad_group_id, AdTypes={'AdType': ['ExpandedText', 'ResponsiveSearch']})

        if not resp or not hasattr(resp, 'Ads') or not resp.Ads or not resp.Ads.Ad:
            return f"No ads found for ad group {ad_group_id}."

        result = f"Ads for Ad Group {ad_group_id}:\n\n"
        for ad in resp.Ads.Ad:
            result += f"**Ad ID: {ad.Id}**\n"
            result += f"  Type: {ad.Type}\n"
            result += f"  Status: {ad.Status}\n"
            if hasattr(ad, 'FinalUrls') and ad.FinalUrls:
                result += f"  URL: {ad.FinalUrls.string[0] if ad.FinalUrls.string else 'N/A'}\n"
            result += "\n"
        return result
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def create_responsive_search_ad(
    ad_group_id: int,
    final_url: str,
    headlines: str,
    descriptions: str,
    path1: str = "",
    path2: str = ""
) -> str:
    """
    Create a Responsive Search Ad.

    Args:
        ad_group_id: Ad Group ID
        final_url: Landing page URL
        headlines: Pipe-separated headlines (3-15 required, max 30 chars each)
        descriptions: Pipe-separated descriptions (2-4 required, max 90 chars each)
        path1: Optional URL path 1 (max 15 chars)
        path2: Optional URL path 2 (max 15 chars)
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        ad = svc.factory.create('ResponsiveSearchAd')
        ad.Type = 'ResponsiveSearch'
        ad.Status = 'Paused'

        # Final URL
        urls = svc.factory.create('ns3:ArrayOfstring')
        urls.string.append(final_url)
        ad.FinalUrls = urls

        # Headlines
        headline_list = [h.strip() for h in headlines.split("|")]
        ad_headlines = svc.factory.create('ArrayOfAssetLink')
        for i, h in enumerate(headline_list[:15]):
            asset_link = svc.factory.create('AssetLink')
            text_asset = svc.factory.create('TextAsset')
            text_asset.Text = h[:30]
            asset_link.Asset = text_asset
            ad_headlines.AssetLink.append(asset_link)
        ad.Headlines = ad_headlines

        # Descriptions
        desc_list = [d.strip() for d in descriptions.split("|")]
        ad_descriptions = svc.factory.create('ArrayOfAssetLink')
        for d in desc_list[:4]:
            asset_link = svc.factory.create('AssetLink')
            text_asset = svc.factory.create('TextAsset')
            text_asset.Text = d[:90]
            asset_link.Asset = text_asset
            ad_descriptions.AssetLink.append(asset_link)
        ad.Descriptions = ad_descriptions

        if path1:
            ad.Path1 = path1[:15]
        if path2:
            ad.Path2 = path2[:15]

        ads = svc.factory.create('ArrayOfAd')
        ads.Ad.append(ad)

        resp = svc.AddAds(AdGroupId=ad_group_id, Ads=ads)

        if resp.AdIds and resp.AdIds.long:
            return f"Responsive Search Ad created (PAUSED):\n- ID: {resp.AdIds.long[0]}\n- Headlines: {len(headline_list)}\n- Descriptions: {len(desc_list)}"
        return f"Failed: {resp.PartialErrors}"
    except Exception as e:
        return f"Error: {str(e)}"

# ============= REPORTING =============

@mcp.tool()
def submit_campaign_performance_report(
    date_range: str = "LastMonth",
    columns: str = "TimePeriod,CampaignName,Impressions,Clicks,Ctr,AverageCpc,Spend,Conversions,CostPerConversion,ConversionRate"
) -> str:
    """
    Submit a campaign performance report request and wait for result.
    Returns CSV data directly (handles async polling internally).

    Args:
        date_range: Yesterday, LastWeek, LastMonth, LastThreeMonths, ThisYear, LastYear
        columns: Comma-separated columns to include
    """
    try:
        auth = get_authorization()
        from bingads.v13.reporting import ReportingServiceManager, ReportingDownloadParameters
        import urllib.request, zipfile, io

        rsm = ReportingServiceManager(
            authorization_data=auth,
            poll_interval_in_milliseconds=5000,
            environment='production',
        )
        svc = rsm.service_client

        report = svc.factory.create('CampaignPerformanceReportRequest')
        report.Aggregation = 'Daily'
        report.Format = 'Csv'
        report.ReturnOnlyCompleteData = False
        report.ReportName = f'Campaign Performance {datetime.now().strftime("%Y%m%d_%H%M%S")}'
        report.ExcludeColumnHeaders = False
        report.ExcludeReportFooter = True
        report.ExcludeReportHeader = True
        report.Time.PredefinedTime = date_range
        report.Time.CustomDateRangeEnd = None
        report.Time.CustomDateRangeStart = None
        report.Scope.AccountIds.long = [int(auth.account_id)]
        report.Scope.Campaigns = None
        report.Columns.CampaignPerformanceReportColumn = [c.strip() for c in columns.split(",")]
        report.Filter = None

        operation = rsm.submit_download(report)
        status = operation.track()

        if status.status == 'Success' and status.report_download_url:
            data = urllib.request.urlopen(status.report_download_url).read()
            z = zipfile.ZipFile(io.BytesIO(data))
            for name in z.namelist():
                content = z.read(name).decode('utf-8-sig')
                return content.strip()
            return "Report downloaded but empty."
        else:
            return f"Report status: {status.status}"
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def submit_keyword_performance_report(
    date_range: str = "LastMonth",
    columns: str = "TimePeriod,Keyword,AdGroupName,CampaignName,Impressions,Clicks,Ctr,AverageCpc,Spend,Conversions,QualityScore"
) -> str:
    """
    Submit a keyword performance report request and return CSV data.

    Args:
        date_range: Yesterday, LastWeek, LastMonth, LastThreeMonths
        columns: Comma-separated columns to include
    """
    try:
        auth = get_authorization()
        from bingads.v13.reporting import ReportingServiceManager
        import urllib.request, zipfile, io

        rsm = ReportingServiceManager(
            authorization_data=auth,
            poll_interval_in_milliseconds=5000,
            environment='production',
        )
        svc = rsm.service_client

        report = svc.factory.create('KeywordPerformanceReportRequest')
        report.Aggregation = 'Daily'
        report.Format = 'Csv'
        report.ReturnOnlyCompleteData = False
        report.ReportName = f'Keyword Performance {datetime.now().strftime("%Y%m%d_%H%M%S")}'
        report.ExcludeColumnHeaders = False
        report.ExcludeReportFooter = True
        report.ExcludeReportHeader = True
        report.Time.PredefinedTime = date_range
        report.Time.CustomDateRangeEnd = None
        report.Time.CustomDateRangeStart = None
        report.Scope.AccountIds.long = [int(auth.account_id)]
        report.Scope.Campaigns = None
        report.Scope.AdGroups = None
        report.Columns.KeywordPerformanceReportColumn = [c.strip() for c in columns.split(",")]
        report.Filter = None

        operation = rsm.submit_download(report)
        status = operation.track()

        if status.status == 'Success' and status.report_download_url:
            data = urllib.request.urlopen(status.report_download_url).read()
            z = zipfile.ZipFile(io.BytesIO(data))
            for name in z.namelist():
                content = z.read(name).decode('utf-8-sig')
                return content.strip()
            return "Report downloaded but empty."
        else:
            return f"Report status: {status.status}"
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def submit_search_query_report(
    date_range: str = "LastMonth",
    columns: str = "TimePeriod,SearchQuery,Keyword,CampaignName,Impressions,Clicks,Spend,Conversions"
) -> str:
    """
    Submit a search query performance report and return CSV data.

    Args:
        date_range: Yesterday, LastWeek, LastMonth, LastThreeMonths
        columns: Comma-separated columns
    """
    try:
        auth = get_authorization()
        from bingads.v13.reporting import ReportingServiceManager
        import urllib.request, zipfile, io

        rsm = ReportingServiceManager(
            authorization_data=auth,
            poll_interval_in_milliseconds=5000,
            environment='production',
        )
        svc = rsm.service_client

        report = svc.factory.create('SearchQueryPerformanceReportRequest')
        report.Aggregation = 'Daily'
        report.Format = 'Csv'
        report.ReturnOnlyCompleteData = False
        report.ReportName = f'Search Query {datetime.now().strftime("%Y%m%d_%H%M%S")}'
        report.ExcludeColumnHeaders = False
        report.ExcludeReportFooter = True
        report.ExcludeReportHeader = True
        report.Time.PredefinedTime = date_range
        report.Time.CustomDateRangeEnd = None
        report.Time.CustomDateRangeStart = None
        report.Scope.AccountIds.long = [int(auth.account_id)]
        report.Scope.Campaigns = None
        report.Scope.AdGroups = None
        report.Columns.SearchQueryPerformanceReportColumn = [c.strip() for c in columns.split(",")]
        report.Filter = None

        operation = rsm.submit_download(report)
        status = operation.track()

        if status.status == 'Success' and status.report_download_url:
            data = urllib.request.urlopen(status.report_download_url).read()
            z = zipfile.ZipFile(io.BytesIO(data))
            for name in z.namelist():
                return z.read(name).decode('utf-8-sig').strip()
        return f"Report status: {status.status}"
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def submit_geographic_report(
    date_range: str = "LastMonth",
    columns: str = "TimePeriod,Country,State,City,CampaignName,Impressions,Clicks,Spend,Conversions"
) -> str:
    """
    Submit a geographic performance report and return CSV data.

    Args:
        date_range: Yesterday, LastWeek, LastMonth, LastThreeMonths
        columns: Comma-separated columns
    """
    try:
        auth = get_authorization()
        from bingads.v13.reporting import ReportingServiceManager
        import urllib.request, zipfile, io

        rsm = ReportingServiceManager(
            authorization_data=auth,
            poll_interval_in_milliseconds=5000,
            environment='production',
        )
        svc = rsm.service_client

        report = svc.factory.create('GeographicPerformanceReportRequest')
        report.Aggregation = 'Daily'
        report.Format = 'Csv'
        report.ReturnOnlyCompleteData = False
        report.ReportName = f'Geographic {datetime.now().strftime("%Y%m%d_%H%M%S")}'
        report.ExcludeColumnHeaders = False
        report.ExcludeReportFooter = True
        report.ExcludeReportHeader = True
        report.Time.PredefinedTime = date_range
        report.Time.CustomDateRangeEnd = None
        report.Time.CustomDateRangeStart = None
        report.Scope.AccountIds.long = [int(auth.account_id)]
        report.Scope.Campaigns = None
        report.Scope.AdGroups = None
        report.Columns.GeographicPerformanceReportColumn = [c.strip() for c in columns.split(",")]
        report.Filter = None

        operation = rsm.submit_download(report)
        status = operation.track()

        if status.status == 'Success' and status.report_download_url:
            data = urllib.request.urlopen(status.report_download_url).read()
            z = zipfile.ZipFile(io.BytesIO(data))
            for name in z.namelist():
                return z.read(name).decode('utf-8-sig').strip()
        return f"Report status: {status.status}"
    except Exception as e:
        return f"Error: {str(e)}"

@mcp.tool()
def poll_report_status(report_id: str = "") -> str:
    """
    Check report status and get download URL when ready.

    Args:
        report_id: Report request ID (uses last submitted if empty)
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='ReportingService', version=13, authorization_data=auth)

        if not report_id:
            tokens = load_tokens()
            report_id = tokens.get('last_report_id', '')

        if not report_id:
            return "No report ID provided and no recent report found."

        resp = svc.PollGenerateReport(ReportRequestId=report_id)

        status = resp.ReportRequestStatus.Status
        if status == 'Success':
            url = resp.ReportRequestStatus.ReportDownloadUrl
            return f"Report ready!\n\nStatus: {status}\nDownload URL: {url}"
        elif status == 'Pending':
            return f"Report still processing...\n\nStatus: {status}\n\nTry again in a few seconds."
        else:
            return f"Report status: {status}"
    except Exception as e:
        return f"Error: {str(e)}"

# ============= BUDGETS =============

@mcp.tool()
def get_budgets() -> str:
    """
    Get budgets from campaigns in the account.

    Note: Shared budgets require specific IDs. This returns budget info from campaigns.
    """
    try:
        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        # Get campaigns to extract budget info
        resp = svc.GetCampaignsByAccountId(
            AccountId=auth.account_id,
            CampaignType='Search DynamicSearchAds Shopping Audience PerformanceMax'
        )

        campaigns = resp.Campaign if resp and hasattr(resp, 'Campaign') and resp.Campaign else []
        if not campaigns:
            return "No campaigns found. Create a campaign first to set a budget."

        result = "Campaign Budgets:\n\n"
        for c in campaigns:
            budget = getattr(c, 'DailyBudget', None) or getattr(c, 'BudgetId', 'Not set')
            result += f"**{c.Name}**\n"
            result += f"  Campaign ID: {c.Id}\n"
            result += f"  Daily Budget: ${float(c.DailyBudget):.2f}\n" if c.DailyBudget else f"  Shared Budget ID: {c.BudgetId}\n"
            result += "\n"
        return result
    except Exception as e:
        return f"Error: {str(e)}"

# ============= LABELS =============

@mcp.tool()
def get_labels(label_ids: str = "") -> str:
    """
    Get labels by ID. Labels are attached to campaigns, ad groups, ads, and keywords.

    Args:
        label_ids: Comma-separated label IDs (empty shows help)
    """
    try:
        if not label_ids:
            return """Labels in Microsoft Ads:

Labels help organize and filter campaigns, ad groups, ads, and keywords.

To use labels:
1. Create labels in Microsoft Ads web UI (Shared Library > Labels)
2. Attach labels to campaigns, ad groups, ads, or keywords
3. Use get_labels('id1,id2') to retrieve label details

Labels appear in campaign/ad group listings when present."""

        auth = get_authorization()
        svc = ServiceClient(service='CampaignManagementService', version=13, authorization_data=auth)

        ids = svc.factory.create('ns1:ArrayOflong')
        for lid in label_ids.split(','):
            ids.long.append(int(lid.strip()))

        resp = svc.GetLabelsByIds(LabelIds=ids)

        if not resp or not hasattr(resp, 'Labels') or not resp.Labels or not resp.Labels.Label:
            return "No labels found with those IDs."

        result = "Labels:\n\n"
        for l in resp.Labels.Label:
            result += f"- {l.Name} (ID: {l.Id})\n"
            if hasattr(l, 'Description') and l.Description:
                result += f"  Description: {l.Description}\n"
        return result
    except Exception as e:
        return f"Error: {str(e)}"

if __name__ == "__main__":
    logger.info("Starting Microsoft Ads MCP server...")
    mcp.run()
