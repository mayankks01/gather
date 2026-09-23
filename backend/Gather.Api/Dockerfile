FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/Gather.Api/ ./
RUN dotnet publish -c Release -o /app
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
# Npgsql loads GSSAPI/Kerberos support on Linux, including when connecting to
# hosted PostgreSQL providers such as Neon. Keep the runtime image minimal.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/App_Data \
    && chown -R app:app /app/App_Data
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Gather.Api.dll"]
