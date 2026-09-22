# OpenCloud 7.5.0: preserve upstream assets, storage and VIPS support.
FROM node@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS assets
RUN apk add --no-cache curl tar && npm install --global pnpm@11.1.3
WORKDIR /source
RUN curl --fail --location --silent --show-error https://github.com/opencloud-eu/opencloud/archive/cd9095833af0ba1dc7449194e62799931d38a7b1.tar.gz -o /tmp/source.tar.gz \
 && echo 'e7c207687cf586d4e0cf7aba7d3250117e4e32f41774308d29a11ca40fbcc885  /tmp/source.tar.gz' | sha256sum -c - \
 && tar xzf /tmp/source.tar.gz --strip-components=1 && rm /tmp/source.tar.gz
RUN curl --fail --location --silent --show-error https://github.com/opencloud-eu/web/releases/download/v7.4.0/web.tar.gz -o /tmp/web.tar.gz \
 && echo '0e943dbb65d7957183520586ab25a90b464f74b371627cc3951dd4379f467741  /tmp/web.tar.gz' | sha256sum -c - \
 && tar xzf /tmp/web.tar.gz -C services/web/assets/core && rm /tmp/web.tar.gz
WORKDIR /source/services/idp
RUN pnpm install --frozen-lockfile && pnpm build \
 && cp src/images/favicon.svg assets/identifier/static/favicon.svg \
 && rm assets/identifier/static/favicon.ico \
 && cp src/images/icon-lilac.svg assets/identifier/static/icon-lilac.svg \
 && rm -rf node_modules

FROM quay.io/opencloudeu/golang-ci@sha256:c2db7034584ca2645aa821bb7bf84ba086fda48176b8159f385bec5e9917508b AS build
WORKDIR /source
COPY --from=assets /source/ ./
COPY . /patch/
RUN python3 /patch/patch.py /source
RUN --mount=type=cache,target=/root/.cache/go-build go test -mod=vendor github.com/opencloud-eu/reva/v2/pkg/blakroles \
    github.com/opencloud-eu/reva/v2/pkg/storage/pkg/decomposedfs/upload \
    github.com/opencloud-eu/reva/v2/pkg/storage/utils/decomposedfs/upload \
    ./services/proxy/pkg/userroles ./services/proxy/pkg/middleware \
    ./services/settings/pkg/service/v0 ./services/collaboration/pkg/middleware
RUN --mount=type=cache,target=/root/.cache/go-build make -C opencloud release-linux-docker-amd64 ENABLE_VIPS=true DIST=/dist VERSION=7.5.0 EDITION=rolling STRING=blak-drive

FROM opencloudeu/opencloud-rolling@sha256:6db1cfb06d430a663f16e9f33dcd4596d82a4875be0b4df233c26ce5f667ea74
COPY --from=build /dist/binaries/opencloud-linux-amd64 /usr/bin/opencloud
