# make sure git tree is empty
import os
import sys
import tomllib


...
# upgrade version
os.system(f"uv version --bump {sys.argv[1]}")

# commit and tag
os.system("git add .")
with open("pyproject.toml", "r", encoding="utf-8") as f:
    project = tomllib.loads(f.read())
    project_version = project["project"]["version"]
os.system(f"git commit -m '{project_version}'")
os.system(f"git tag -a -s {project_version} -m {project_version}")
os.system("git push --follow-tags")
