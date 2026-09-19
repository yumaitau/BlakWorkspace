from authentik.brands.models import Brand

CSS = """
/* Blak Workspace identity theme: Blak Dark */
body { background: #0B1112 !important; color: #F4EBDD !important; }
[class*="background-image"] { background: #0B1112 !important; }
[class*="login__main"], [class*="card"], [class*="modal"] { background: #101819 !important; border-color: #263436 !important; }
button[type=submit], [class*="button"][class*="primary"] { background: #D65B2E !important; color: #FFF4E5 !important; font-weight: 600 !important; }
button[type=submit]:hover, [class*="button"][class*="primary"]:hover { background: #E77832 !important; }
h1, h2 { color: #F4EBDD !important; }
label { color: #B8B5AA !important; }
a { color: #3199A2 !important; }
input { background: #0D1516 !important; border-color: #304043 !important; color: #F4EBDD !important; }
input:focus { border-color: #3199A2 !important; }
"""

brand = Brand.objects.get(default=True)
brand.branding_title = "Blak ID"
brand.branding_custom_css = CSS
brand.save()
print("BRAND_CSS_OK")
